import { McapIndexedReader } from '@mcap/core';
import type { IReadable, DecompressHandlers } from '@mcap/core';
import { decompress as zstdDecompress } from 'fzstd';
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
  if (level == null) return 'DEBUG';
  return ROS2_SEVERITY[level] ?? 'DEBUG';
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
    const buffer = await file.arrayBuffer();
    const readable = new BlobReadable(buffer);

    const decompressHandlers: DecompressHandlers = {
      zstd: (data) =>
        zstdDecompress(new Uint8Array(data)),
    };

    const reader = await McapIndexedReader.Initialize({
      readable,
      decompressHandlers,
    });

    // Build message readers per channel
    const channelReaders = new Map<number, { reader: Ros2MessageReader; kind: 'rosout' | 'diagnostics' }>();

    for (const channel of reader.channelsById.values()) {
      const schema = reader.schemasById.get(channel.schemaId);
      if (!schema) continue;

      const schemaName = schema.name;
      let kind: 'rosout' | 'diagnostics' | null = null;

      if (isRosoutSchema(schemaName)) {
        kind = 'rosout';
      } else if (isDiagnosticsSchema(schemaName)) {
        kind = 'diagnostics';
      }

      if (kind && schema.data.length > 0) {
        const schemaText = new TextDecoder().decode(schema.data);
        const msgDef = parseMessageDefinition(schemaText, { ros2: true });
        const msgReader = new Ros2MessageReader(msgDef);
        channelReaders.set(channel.id, { reader: msgReader, kind });
      }
    }

    if (channelReaders.size === 0) {
      const availableTopics = Array.from(reader.channelsById.values())
        .map(ch => {
          const schema = reader.schemasById.get(ch.schemaId);
          return `  - ${ch.topic} [${schema?.name ?? 'unknown'}]`;
        })
        .join('\n');

      throw new Error(
        `No rosout or diagnostics topics found in MCAP file.\n\nAvailable topics:\n${availableTopics}\n\n` +
        `Looking for schemas: 'rcl_interfaces/msg/Log', 'rosgraph_msgs/msg/Log', or 'diagnostic_msgs/msg/DiagnosticArray'`
      );
    }

    const messages: RosoutMessage[] = [];
    const uniqueNodes = new Set<string>();
    const diagnostics: DiagnosticStatusEntry[] = [];
    let hasDiagnostics = false;

    for await (const message of reader.readMessages()) {
      const channelInfo = channelReaders.get(message.channelId);
      if (!channelInfo) continue;

      const { reader: msgReader, kind } = channelInfo;

      if (kind === 'rosout') {
        const msg = msgReader.readMessage<Ros2LogMessage>(message.data);
        const timestamp = msg.stamp
          ? msg.stamp.sec + msg.stamp.nanosec / 1e9
          : Number(message.logTime) / 1e9;
        const node = msg.name || 'unknown';

        messages.push({
          timestamp,
          node,
          severity: toSeverity(msg.level),
          message: msg.msg || '',
          file: msg.file,
          line: msg.line,
          function: msg.function,
        });

        uniqueNodes.add(node);
      } else if (kind === 'diagnostics') {
        hasDiagnostics = true;
        const msg = msgReader.readMessage<Ros2DiagnosticArray>(message.data);
        const headerTimestamp = msg.header?.stamp
          ? msg.header.stamp.sec + msg.header.stamp.nanosec / 1e9
          : Number(message.logTime) / 1e9;

        if (msg.status) {
          for (const status of msg.status) {
            diagnostics.push({
              timestamp: headerTimestamp,
              name: status.name || 'unknown',
              level: status.level ?? 0,
              message: status.message || '',
              values: status.values || [],
            });
          }
        }
      }
    }

    messages.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`✓ Successfully loaded ${messages.length} rosout messages from ${uniqueNodes.size} nodes`);
    if (hasDiagnostics) {
      console.log(`✓ Successfully loaded ${diagnostics.length} diagnostics entries`);
    }

    return { messages, uniqueNodes, diagnostics, hasDiagnostics };
  } catch (error) {
    console.error('!!! Error loading MCAP file !!!');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error);
    throw error;
  }
}
