import { McapIndexedReader, McapStreamReader } from '@mcap/core';
import type { IReadable, DecompressHandlers, TypedMcapRecord } from '@mcap/core';
import { decompress as zstdDecompress } from 'fzstd';
import lz4 from 'lz4js';
import { MessageReader as Ros2MessageReader } from '@foxglove/rosmsg2-serialization';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';

import type { RosoutMessage, DiagnosticStatusEntry, SeverityLevel } from './types';
import { ROS2_SEVERITY } from './types';

class BlobReadable implements IReadable {
  private buffer: ArrayBuffer;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
  }

  async size(): Promise<bigint> {
    return BigInt(this.buffer.byteLength);
  }

  async read(offset: bigint, length: bigint): Promise<Uint8Array> {
    return new Uint8Array(this.buffer, Number(offset), Number(length));
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

  addChannel(id: number, schemaId: number) {
    this.buildReaderForChannel(id, schemaId);
    // If schema wasn't available yet, queue for later
    if (!this.channelReaders.has(id)) {
      this.pendingChannels.set(id, schemaId);
    }
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
    };
  }
}

async function readIndexed(buffer: ArrayBuffer, decompressHandlers: DecompressHandlers) {
  const readable = new BlobReadable(buffer);
  const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });

  const collector = new McapMessageCollector();

  for (const schema of reader.schemasById.values()) {
    collector.addSchema(schema.id, schema.name, schema.data);
  }
  for (const channel of reader.channelsById.values()) {
    collector.addChannel(channel.id, channel.schemaId);
  }

  for await (const message of reader.readMessages()) {
    collector.processMessage(message.channelId, message.logTime, message.data);
  }

  return collector.result();
}

function readStreaming(buffer: ArrayBuffer, decompressHandlers: DecompressHandlers) {
  const streamReader = new McapStreamReader({ decompressHandlers });
  streamReader.append(new Uint8Array(buffer));

  const collector = new McapMessageCollector();

  let record: TypedMcapRecord | undefined;
  while ((record = streamReader.nextRecord()) != null) {
    switch (record.type) {
      case 'Schema':
        collector.addSchema(record.id, record.name, record.data);
        break;
      case 'Channel':
        collector.addChannel(record.id, record.schemaId);
        break;
      case 'Message':
        collector.processMessage(record.channelId, record.logTime, record.data);
        break;
    }
  }

  return collector.result();
}

export async function loadMcapMessages(file: File): Promise<{
  messages: RosoutMessage[];
  uniqueNodes: Set<string>;
  diagnostics: DiagnosticStatusEntry[];
  hasDiagnostics: boolean;
}> {
  console.log('=== Starting MCAP load ===');
  console.log('File name:', file.name);
  console.log('File size:', file.size, 'bytes');

  try {
    let buffer = await file.arrayBuffer();

    // Detect outer zstd compression by magic bytes (0x28 0xB5 0x2F 0xFD)
    if (buffer.byteLength >= 4) {
      const magic = new Uint8Array(buffer, 0, 4);
      if (magic[0] === 0x28 && magic[1] === 0xb5 && magic[2] === 0x2f && magic[3] === 0xfd) {
        const decompressed = zstdDecompress(new Uint8Array(buffer));
        if (decompressed.byteOffset === 0 && decompressed.byteLength === decompressed.buffer.byteLength) {
          buffer = decompressed.buffer as ArrayBuffer;
        } else {
          buffer = decompressed.slice().buffer as ArrayBuffer;
        }
      }
    }

    const decompressHandlers: DecompressHandlers = {
      zstd: (data) => zstdDecompress(new Uint8Array(data)),
      lz4: (data) => lz4.decompress(new Uint8Array(data)),
    };

    // Try indexed reader first, fall back to streaming for non-indexed or unchunked files
    let result;
    try {
      result = await readIndexed(buffer, decompressHandlers);
      // Indexed reader may succeed but yield 0 messages for unchunked MCAPs;
      // fall back to streaming which reads Message records directly.
      if (result.messages.length === 0 && !result.hasDiagnostics) {
        result = readStreaming(buffer, decompressHandlers);
      }
    } catch {
      result = readStreaming(buffer, decompressHandlers);
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
