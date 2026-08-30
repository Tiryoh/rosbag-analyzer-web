import { McapIndexedReader, McapStreamReader } from '@mcap/core';
import type { IReadable, DecompressHandlers, TypedMcapRecord } from '@mcap/core';
import { decompress as zstdDecompress } from 'fzstd';
import lz4 from 'lz4js';
import { MessageReader as Ros2MessageReader } from '@foxglove/rosmsg2-serialization';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';

import type { BagSource, RosoutMessage, DiagnosticStatusEntry, SeverityLevel, TopicInfo, ProgressCallback } from './types';
import { ROS2_SEVERITY } from './types';
import { yieldToEventLoop, shouldEmit } from './progressUtils';

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

  /** Which collector list a channel feeds, or undefined if it feeds neither. */
  channelKind(channelId: number): 'rosout' | 'diagnostics' | undefined {
    return this.channelReaders.get(channelId)?.kind;
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

async function readIndexed(
  readable: IReadable,
  decompressHandlers: DecompressHandlers,
  fileSize: number,
  onProgress?: ProgressCallback,
) {
  const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });

  const collector = new McapMessageCollector();

  for (const schema of reader.schemasById.values()) {
    collector.addSchema(schema.id, schema.name, schema.data);
  }
  for (const channel of reader.channelsById.values()) {
    collector.addChannel(channel.id, channel.schemaId, channel.topic);
  }

  // Identify channels whose schema is rosout or diagnostics so we can:
  //   1. Filter readMessages() to only relevant channels (keeps processed <= total)
  //   2. Compute total from statistics for those channels only
  const relevantChannelIds = new Set<number>();
  let hasRosoutChannels = false;
  for (const channel of reader.channelsById.values()) {
    const schema = reader.schemasById.get(channel.schemaId);
    if (!schema) continue;
    if (isRosoutSchema(schema.name)) {
      relevantChannelIds.add(channel.id);
      hasRosoutChannels = true;
    } else if (isDiagnosticsSchema(schema.name)) {
      relevantChannelIds.add(channel.id);
    }
  }

  // Determine topics for the readMessages filter
  const relevantTopics = [...relevantChannelIds]
    .map((id) => reader.channelsById.get(id)?.topic)
    .filter((t): t is string => t !== undefined);

  // Restrict the read to rosout/diagnostics topics when we have them: it keeps
  // `processed` on the same population as `total`, and lets the reader skip
  // chunks that hold nothing we collect.
  const didFilter = relevantTopics.length > 0;
  const readOptions = didFilter ? { topics: relevantTopics } : {};

  // Compute total message count for relevant channels from statistics.
  // Both values use source-record counts (not collected rows) so processed <= total holds.
  // Without the topic filter the read spans every channel in the file, so there
  // is no population `total` could describe — stay indeterminate there.
  let total: number | undefined;
  if (didFilter && reader.statistics && reader.statistics.channelMessageCounts) {
    let bigTotal = BigInt(0);
    for (const channelId of relevantChannelIds) {
      const count = reader.statistics.channelMessageCounts.get(channelId);
      if (count !== undefined) {
        bigTotal += count;
      }
    }
    const asNumber = Number(bigTotal);
    total = asNumber <= Number.MAX_SAFE_INTEGER ? asNumber : undefined;
  }

  // `processed` and `total` are a pair: emit the numerator only when the
  // denominator exists, so consumers never see a half-populated ratio.
  const determinate = total !== undefined;

  // Only claim 'diagnostics' when diagnostics are the only relevant channels.
  // With no relevant channels at all neither label describes the read, so keep
  // the default.
  let phase: 'rosout' | 'diagnostics' = didFilter && !hasRosoutChannels ? 'diagnostics' : 'rosout';

  const emit = (processed: number) => {
    if (!onProgress) return;
    const messageCount =
      phase === 'diagnostics' ? collector.diagnostics.length : collector.messages.length;
    onProgress({
      phase,
      messageCount,
      processed: determinate ? processed : undefined,
      total,
      fileSize,
    });
  };

  emit(0);

  // `recordCounter` counts every record the read yields — it drives throttling
  // and the streaming-fallback decision. `processedCounter` is the progress
  // numerator and counts only records inside `total`'s population: the topic
  // filter also admits channels that merely share a topic with a relevant one.
  let recordCounter = 0;
  let processedCounter = 0;

  for await (const message of reader.readMessages(readOptions)) {
    recordCounter++;
    collector.processMessage(message.channelId, message.logTime, message.data);

    if (relevantChannelIds.has(message.channelId)) {
      processedCounter++;
      // Determine current phase from this message's channel schema
      const schema = reader.schemasById.get(reader.channelsById.get(message.channelId)?.schemaId ?? 0);
      phase = schema && isDiagnosticsSchema(schema.name) ? 'diagnostics' : 'rosout';
    }

    if (onProgress && shouldEmit(recordCounter)) {
      emit(processedCounter);
      await yieldToEventLoop();
    }
  }

  // Final emit: the throttle above only fires on exact multiples of 100, so
  // without this the UI would under-report by up to 99 records.
  if (recordCounter > 0) {
    emit(processedCounter);
  }

  // The streaming fallback exists for MCAPs the indexed reader cannot read at
  // all (e.g. unchunked). Because the read above is filtered to rosout/
  // diagnostics topics, "no records" is *also* the correct answer for a valid
  // file whose relevant channels happen to be empty — reporting 0 there would
  // trigger a needless full materialization and re-parse. So when the filtered
  // read comes up empty, probe the unfiltered stream for a single record to
  // tell the two cases apart. The probe decompresses at most one chunk and only
  // runs on the empty path.
  let sawAnyMessageRecord = recordCounter > 0;
  if (!sawAnyMessageRecord && didFilter) {
    for await (const probe of reader.readMessages()) {
      sawAnyMessageRecord = probe != null;
      break;
    }
  }

  return { ...collector.result(), sawAnyMessageRecord };
}

function readStreaming(
  bytes: Uint8Array,
  decompressHandlers: DecompressHandlers,
  fileSize: number,
  onProgress?: ProgressCallback,
) {
  const streamReader = new McapStreamReader({ decompressHandlers });
  streamReader.append(bytes);

  const collector = new McapMessageCollector();

  // Streaming has no determinate progress (processed/total stay undefined), so
  // the phase and its message count are the only feedback the UI gets — they
  // have to follow the channel actually being read.
  let phase: 'rosout' | 'diagnostics' = 'rosout';
  const emit = () => {
    if (!onProgress) return;
    const messageCount =
      phase === 'diagnostics' ? collector.diagnostics.length : collector.messages.length;
    onProgress({ phase, messageCount, fileSize });
  };

  let processedCounter = 0;
  let record: TypedMcapRecord | undefined;
  while ((record = streamReader.nextRecord()) != null) {
    switch (record.type) {
      case 'Schema':
        collector.addSchema(record.id, record.name, record.data);
        break;
      case 'Channel':
        collector.addChannel(record.id, record.schemaId, record.topic);
        break;
      case 'Message': {
        collector.processMessage(record.channelId, record.logTime, record.data);
        processedCounter++;
        const kind = collector.channelKind(record.channelId);
        if (kind) phase = kind;
        if (shouldEmit(processedCounter)) {
          emit();
        }
        break;
      }
    }
  }

  // Final emit: the throttle above only fires on exact multiples of 100, so
  // without this the UI would stay at 0 for files with under 100 records.
  if (processedCounter > 0) {
    emit();
  }

  return collector.result();
}

/**
 * The indexed attempt can emit a determinate {processed, total} pair before it
 * comes up empty or throws. readStreaming runs synchronously and never yields,
 * so unless that state is cleared first the UI paints the last indexed event —
 * a bar stalled at 0% — for the whole streaming parse.
 */
async function resetProgressBeforeStreaming(fileSize: number, onProgress?: ProgressCallback) {
  if (!onProgress) return;
  onProgress({ phase: 'open', messageCount: 0, fileSize });
  await yieldToEventLoop();
}

export async function loadMcapMessages(
  source: BagSource,
  onProgress?: ProgressCallback,
): Promise<{
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

    const fileSize = source.size;

    // Emit 'open' phase immediately so the UI shows activity.
    onProgress?.({ phase: 'open', messageCount: 0, fileSize });

    // Detect outer zstd compression by magic bytes (0x28 0xB5 0x2F 0xFD).
    // For zstd-wrapped MCAPs we must materialize the full file to decompress;
    // for plain MCAPs we keep the lazy IReadable so peak memory stays low.
    const head = await source.read(0, Math.min(4, source.size));
    const isZstd = head.byteLength >= 4 && head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd;

    let result;
    if (isZstd) {
      // Re-emit 'open' during the materialization step (zstd decompression has no
      // determinate progress — no processed/total available).
      onProgress?.({ phase: 'open', messageCount: 0, fileSize });
      const compressed = await source.read(0, source.size);
      const bytes = zstdDecompress(compressed);
      try {
        result = await readIndexed(new Uint8ArrayReadable(bytes), decompressHandlers, fileSize, onProgress);
        // Indexed reader may succeed but yield 0 records for unchunked MCAPs;
        // fall back to streaming only when no Message records were seen at all
        // (a file with unrelated topics still has records, just not rosout/diag).
        if (!result.sawAnyMessageRecord) {
          await resetProgressBeforeStreaming(fileSize, onProgress);
          result = readStreaming(bytes, decompressHandlers, fileSize, onProgress);
        }
      } catch {
        await resetProgressBeforeStreaming(fileSize, onProgress);
        result = readStreaming(bytes, decompressHandlers, fileSize, onProgress);
      }
    } else {
      const readable = new BagSourceReadable(source);
      try {
        result = await readIndexed(readable, decompressHandlers, fileSize, onProgress);
        if (!result.sawAnyMessageRecord) {
          await resetProgressBeforeStreaming(fileSize, onProgress);
          const bytes = await source.read(0, source.size);
          result = readStreaming(bytes, decompressHandlers, fileSize, onProgress);
        }
      } catch {
        await resetProgressBeforeStreaming(fileSize, onProgress);
        const bytes = await source.read(0, source.size);
        result = readStreaming(bytes, decompressHandlers, fileSize, onProgress);
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
