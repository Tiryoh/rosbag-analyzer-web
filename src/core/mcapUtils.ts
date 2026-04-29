import { McapIndexedReader, McapStreamReader } from '@mcap/core';
import type { IReadable, DecompressHandlers, TypedMcapRecord } from '@mcap/core';
import { decompress as zstdDecompress } from 'fzstd';
import lz4 from 'lz4js';
import { MessageReader as Ros2MessageReader } from '@foxglove/rosmsg2-serialization';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';

import type { BagSource, RosoutMessage, DiagnosticStatusEntry, SeverityLevel, TopicInfo } from './types';
import { ROS2_SEVERITY } from './types';

class Uint8ArrayReadable implements IReadable {
  constructor(private readonly bytes: Uint8Array) {}

  async size(): Promise<bigint> {
    return BigInt(this.bytes.byteLength);
  }

  async read(offset: bigint, length: bigint): Promise<Uint8Array> {
    const start = Number(offset);
    const end = start + Number(length);
    return this.bytes.subarray(start, end);
  }
}

/** Lazy IReadable adapter — random-access reads stream from BagSource. */
class BagSourceReadable implements IReadable {
  constructor(private readonly source: BagSource) {}

  async size(): Promise<bigint> {
    return BigInt(this.source.size);
  }

  async read(offset: bigint, length: bigint): Promise<Uint8Array> {
    return this.source.read(Number(offset), Number(length));
  }
}

// ROS2 rcl_interfaces/msg/Log fields
interface Ros2LogMessage {
  stamp?: { sec: number; nanosec: number };
  level?: number;
  name?: string;
  msg?: string;
  file?: string;
  line?: number;
  function?: string;
}

// ROS2 diagnostic_msgs/msg/DiagnosticArray
interface Ros2DiagnosticArray {
  header?: { stamp: { sec: number; nanosec: number } };
  status?: Array<{
    level?: number;
    name?: string;
    message?: string;
    hardware_id?: string;
    values?: Array<{ key: string; value: string }>;
  }>;
}

function isRosoutSchema(schemaName: string): boolean {
  return (
    schemaName === 'rcl_interfaces/msg/Log' ||
    schemaName === 'rosgraph_msgs/msg/Log'
  );
}

function isDiagnosticsSchema(schemaName: string): boolean {
  return schemaName === 'diagnostic_msgs/msg/DiagnosticArray';
}

function toSeverity(level: number | undefined): SeverityLevel {
  if (level == null) return 'UNKNOWN';
  return ROS2_SEVERITY[level] ?? 'UNKNOWN';
}


/**
 * Shared message-processing logic used by both indexed and streaming readers.
 */
class McapMessageCollector {
  private channelReaders = new Map<number, { reader: Ros2MessageReader; kind: 'rosout' | 'diagnostics' }>();
  private schemasById = new Map<number, { name: string; data: Uint8Array }>();
  private pendingChannels = new Map<number, number>(); // channelId → schemaId (for channels received before their schema)
  private lastDiagState = new Map<string, { level: number; message: string; valuesKey: string }>();
  private channelTopics = new Map<number, { topic: string; schemaId: number }>();

  messages: RosoutMessage[] = [];
  uniqueNodes = new Set<string>();
  diagnostics: DiagnosticStatusEntry[] = [];
  hasDiagnostics = false;

  addSchema(id: number, name: string, data: Uint8Array) {
    this.schemasById.set(id, { name, data });
    // Retry any channels that were waiting for this schema
    for (const [channelId, schemaId] of this.pendingChannels) {
      if (schemaId === id) {
        this.buildReaderForChannel(channelId, schemaId);
        this.pendingChannels.delete(channelId);
      }
    }
  }

  addChannel(id: number, schemaId: number, topic: string) {
    this.channelTopics.set(id, { topic, schemaId });
    this.buildReaderForChannel(id, schemaId);
    // If schema wasn't available yet, queue for later
    if (!this.channelReaders.has(id)) {
      this.pendingChannels.set(id, schemaId);
    }
  }

  availableTopics(): TopicInfo[] {
    return Array.from(this.channelTopics.values()).map(({ topic, schemaId }) => ({
      topic,
      type: this.schemasById.get(schemaId)?.name ?? 'unknown',
    }));
  }

  private buildReaderForChannel(channelId: number, schemaId: number) {
    const schema = this.schemasById.get(schemaId);
    if (!schema) return;

    let kind: 'rosout' | 'diagnostics' | null = null;
    if (isRosoutSchema(schema.name)) kind = 'rosout';
    else if (isDiagnosticsSchema(schema.name)) kind = 'diagnostics';

    if (kind && schema.data.length > 0) {
      const schemaText = new TextDecoder().decode(schema.data);
      const msgDef = parseMessageDefinition(schemaText, { ros2: true });
      const msgReader = new Ros2MessageReader(msgDef);
      this.channelReaders.set(channelId, { reader: msgReader, kind });
    }
  }

  processMessage(channelId: number, logTime: bigint, data: Uint8Array) {
    const channelInfo = this.channelReaders.get(channelId);
    if (!channelInfo) return;

    const { reader: msgReader, kind } = channelInfo;

    if (kind === 'rosout') {
      const msg = msgReader.readMessage<Ros2LogMessage>(data);
      const timestamp = msg.stamp
        ? msg.stamp.sec + msg.stamp.nanosec / 1e9
        : Number(logTime) / 1e9;
      const node = msg.name || 'unknown';

      this.messages.push({
        timestamp,
        node,
        severity: toSeverity(msg.level),
        message: msg.msg || '',
        file: msg.file,
        line: msg.line,
        function: msg.function,
      });

      this.uniqueNodes.add(node);
    } else if (kind === 'diagnostics') {
      this.hasDiagnostics = true;
      const msg = msgReader.readMessage<Ros2DiagnosticArray>(data);
      const headerTimestamp = msg.header?.stamp
        ? msg.header.stamp.sec + msg.header.stamp.nanosec / 1e9
        : Number(logTime) / 1e9;

      if (msg.status) {
        for (const status of msg.status) {
          const name = status.name || 'unknown';
          const level = status.level ?? 0;
          const message = status.message || '';

          const values = status.values || [];
          const valuesKey = values.map(v => `${v.key}=${v.value}`).join(',');
          const prev = this.lastDiagState.get(name);
          if (!prev || prev.level !== level || prev.message !== message || prev.valuesKey !== valuesKey) {
            this.lastDiagState.set(name, { level, message, valuesKey });
            this.diagnostics.push({
              timestamp: headerTimestamp,
              name,
              level,
              message,
              values,
            });
          }
        }
      }
    }
  }

  result() {
    this.messages.sort((a, b) => a.timestamp - b.timestamp);
    return {
      messages: this.messages,
      uniqueNodes: this.uniqueNodes,
      diagnostics: this.diagnostics,
      hasDiagnostics: this.hasDiagnostics,
      availableTopics: this.availableTopics(),
    };
  }
}

async function readIndexed(readable: IReadable, decompressHandlers: DecompressHandlers) {
  const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });

  const collector = new McapMessageCollector();

  for (const schema of reader.schemasById.values()) {
    collector.addSchema(schema.id, schema.name, schema.data);
  }
  for (const channel of reader.channelsById.values()) {
    collector.addChannel(channel.id, channel.schemaId, channel.topic);
  }

  for await (const message of reader.readMessages()) {
    collector.processMessage(message.channelId, message.logTime, message.data);
  }

  return collector.result();
}

function readStreaming(bytes: Uint8Array, decompressHandlers: DecompressHandlers) {
  const streamReader = new McapStreamReader({ decompressHandlers });
  streamReader.append(bytes);

  const collector = new McapMessageCollector();

  let record: TypedMcapRecord | undefined;
  while ((record = streamReader.nextRecord()) != null) {
    switch (record.type) {
      case 'Schema':
        collector.addSchema(record.id, record.name, record.data);
        break;
      case 'Channel':
        collector.addChannel(record.id, record.schemaId, record.topic);
        break;
      case 'Message':
        collector.processMessage(record.channelId, record.logTime, record.data);
        break;
    }
  }

  return collector.result();
}

export async function loadMcapMessages(source: BagSource): Promise<{
  messages: RosoutMessage[];
  uniqueNodes: Set<string>;
  diagnostics: DiagnosticStatusEntry[];
  hasDiagnostics: boolean;
  availableTopics: TopicInfo[];
}> {
  console.log('=== Starting MCAP load ===');
  console.log('File name:', source.name);
  console.log('File size:', source.size, 'bytes');

  try {
    const decompressHandlers: DecompressHandlers = {
      zstd: (data) => zstdDecompress(new Uint8Array(data)),
      lz4: (data) => lz4.decompress(new Uint8Array(data)),
    };

    // Detect outer zstd compression by magic bytes (0x28 0xB5 0x2F 0xFD).
    // For zstd-wrapped MCAPs we must materialize the full file to decompress;
    // for plain MCAPs we keep the lazy IReadable so peak memory stays low.
    const head = await source.read(0, Math.min(4, source.size));
    const isZstd = head.byteLength >= 4 && head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd;

    let result;
    if (isZstd) {
      const compressed = await source.read(0, source.size);
      const bytes = zstdDecompress(compressed);
      try {
        result = await readIndexed(new Uint8ArrayReadable(bytes), decompressHandlers);
        if (result.messages.length === 0 && !result.hasDiagnostics) {
          result = readStreaming(bytes, decompressHandlers);
        }
      } catch {
        result = readStreaming(bytes, decompressHandlers);
      }
    } else {
      const readable = new BagSourceReadable(source);
      try {
        result = await readIndexed(readable, decompressHandlers);
        // Indexed reader may succeed but yield 0 messages for unchunked MCAPs;
        // fall back to streaming which reads records sequentially.
        if (result.messages.length === 0 && !result.hasDiagnostics) {
          const bytes = await source.read(0, source.size);
          result = readStreaming(bytes, decompressHandlers);
        }
      } catch {
        const bytes = await source.read(0, source.size);
        result = readStreaming(bytes, decompressHandlers);
      }
    }

    console.log(`✓ Successfully loaded ${result.messages.length} rosout messages from ${result.uniqueNodes.size} nodes`);
    if (result.hasDiagnostics) {
      console.log(`✓ Successfully loaded ${result.diagnostics.length} diagnostics entries`);
    }

    return result;
  } catch (error) {
    console.error('!!! Error loading MCAP file !!!');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error);
    throw error;
  }
}
