/**
 * Browser-based rosbag reindex utility.
 *
 * Reads an unindexed ROS1 bag file, scans all chunks to rebuild
 * index structures, and produces a new properly-indexed bag file.
 */

const PREAMBLE = '#ROSBAG V2.0\n';
const PREAMBLE_LENGTH = 13;
const OP_MESSAGE_DATA = 0x02;
const OP_BAG_HEADER = 0x03;
const OP_INDEX_DATA = 0x04;
const OP_CHUNK = 0x05;
const OP_CHUNK_INFO = 0x06;
const OP_CONNECTION = 0x07;

interface Time {
  sec: number;
  nsec: number;
}

interface IndexEntry {
  time: Time;
  offset: number; // offset within decompressed chunk data
}

interface ConnectionData {
  conn: number;
  topic: string;
  headerBytes: Uint8Array; // raw header bytes of the connection record
  dataBytes: Uint8Array;   // raw data bytes of the connection record
}

interface ChunkScanResult {
  chunkOffset: number;
  chunkRawBytes: Uint8Array;
  connections: Map<number, ConnectionData>;
  messageIndices: Map<number, IndexEntry[]>;
  startTime: Time;
  endTime: Time;
}

type DecompressFn = (buffer: Uint8Array, size: number) => Uint8Array;
type Decompress = Record<string, DecompressFn>;

// --- Binary write helpers ---

function writeUint32(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, true);
}

function writeUint64(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, (value / 0x100000000) >>> 0, true);
}

function writeTime(buf: Uint8Array, offset: number, time: Time): void {
  writeUint32(buf, offset, time.sec);
  writeUint32(buf, offset + 4, time.nsec);
}

// --- Header field parsing ---

function extractFields(header: Uint8Array): Map<string, Uint8Array> {
  const fields = new Map<string, Uint8Array>();
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  let offset = 0;
  while (offset + 4 <= header.length) {
    const fieldLen = view.getUint32(offset, true);
    offset += 4;
    if (fieldLen === 0 || offset + fieldLen > header.length) break;
    const fieldBytes = header.subarray(offset, offset + fieldLen);
    // Find first '=' (0x3D)
    const eqIdx = fieldBytes.indexOf(0x3d);
    if (eqIdx >= 0) {
      const key = new TextDecoder().decode(fieldBytes.subarray(0, eqIdx));
      const value = fieldBytes.subarray(eqIdx + 1);
      fields.set(key, value);
    }
    offset += fieldLen;
  }
  return fields;
}

function getOpCode(fields: Map<string, Uint8Array>): number {
  const op = fields.get('op');
  if (!op || op.length === 0) return -1;
  return op[0];
}

function getUint32Field(fields: Map<string, Uint8Array>, name: string): number {
  const val = fields.get(name);
  if (!val || val.length < 4) return 0;
  return new DataView(val.buffer, val.byteOffset, val.byteLength).getUint32(0, true);
}

function getStringField(fields: Map<string, Uint8Array>, name: string): string {
  const val = fields.get(name);
  if (!val) return '';
  return new TextDecoder().decode(val);
}

// --- Record reading ---

interface RawRecord {
  headerLen: number;
  header: Uint8Array;
  dataLen: number;
  data: Uint8Array;
  totalLen: number; // 4 + headerLen + 4 + dataLen
}

function readRawRecord(data: Uint8Array, offset: number): RawRecord {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (offset + 4 > data.length) throw new Error('Truncated record: cannot read header length');
  const headerLen = view.getUint32(offset, true);
  if (offset + 4 + headerLen + 4 > data.length) throw new Error('Truncated record: cannot read data length');
  const header = data.subarray(offset + 4, offset + 4 + headerLen);
  const dataLen = view.getUint32(offset + 4 + headerLen, true);
  if (offset + 4 + headerLen + 4 + dataLen > data.length) throw new Error('Truncated record');
  const recordData = data.subarray(offset + 4 + headerLen + 4, offset + 4 + headerLen + 4 + dataLen);
  return {
    headerLen,
    header,
    dataLen,
    data: recordData,
    totalLen: 4 + headerLen + 4 + dataLen,
  };
}

// --- Record building ---

function buildHeaderBytes(fields: [string, Uint8Array][]): Uint8Array {
  const encoder = new TextEncoder();
  const encodedKeys = fields.map(([key]) => encoder.encode(key));
  let totalLen = 0;
  for (let i = 0; i < fields.length; i++) {
    totalLen += 4 + encodedKeys[i].length + 1 + fields[i][1].length;
  }
  const buf = new Uint8Array(totalLen);
  let offset = 0;
  for (let i = 0; i < fields.length; i++) {
    const keyBytes = encodedKeys[i];
    const value = fields[i][1];
    const fieldLen = keyBytes.length + 1 + value.length;
    writeUint32(buf, offset, fieldLen);
    offset += 4;
    buf.set(keyBytes, offset);
    offset += keyBytes.length;
    buf[offset] = 0x3d; // '='
    offset += 1;
    buf.set(value, offset);
    offset += value.length;
  }
  return buf;
}

function buildRecord(headerFields: [string, Uint8Array][], data: Uint8Array): Uint8Array {
  const headerBytes = buildHeaderBytes(headerFields);
  const record = new Uint8Array(4 + headerBytes.length + 4 + data.length);
  writeUint32(record, 0, headerBytes.length);
  record.set(headerBytes, 4);
  writeUint32(record, 4 + headerBytes.length, data.length);
  record.set(data, 4 + headerBytes.length + 4);
  return record;
}

function uint8(value: number): Uint8Array {
  return new Uint8Array([value]);
}

function uint32Bytes(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  writeUint32(buf, 0, value);
  return buf;
}

function uint64Bytes(value: number): Uint8Array {
  const buf = new Uint8Array(8);
  writeUint64(buf, 0, value);
  return buf;
}

function timeBytes(time: Time): Uint8Array {
  const buf = new Uint8Array(8);
  writeTime(buf, 0, time);
  return buf;
}

function timeLessThan(a: Time, b: Time): boolean {
  return a.sec < b.sec || (a.sec === b.sec && a.nsec < b.nsec);
}

function timeGreaterThan(a: Time, b: Time): boolean {
  return a.sec > b.sec || (a.sec === b.sec && a.nsec > b.nsec);
}

// --- Chunk scanning ---

function scanChunkData(
  chunkData: Uint8Array,
): { connections: Map<number, ConnectionData>; messageIndices: Map<number, IndexEntry[]>; startTime: Time; endTime: Time } {
  const connections = new Map<number, ConnectionData>();
  const messageIndices = new Map<number, IndexEntry[]>();
  let startTime: Time = { sec: 0xffffffff, nsec: 0xffffffff };
  let endTime: Time = { sec: 0, nsec: 0 };
  let hasMessages = false;

  let offset = 0;
  while (offset < chunkData.length) {
    try {
      const record = readRawRecord(chunkData, offset);
      const fields = extractFields(record.header);
      const op = getOpCode(fields);

      if (op === OP_CONNECTION) {
        const conn = getUint32Field(fields, 'conn');
        const topic = getStringField(fields, 'topic');
        if (!connections.has(conn)) {
          connections.set(conn, {
            conn,
            topic,
            headerBytes: record.header.slice(),
            dataBytes: record.data.slice(),
          });
        }
      } else if (op === OP_MESSAGE_DATA) {
        const conn = getUint32Field(fields, 'conn');
        const timeField = fields.get('time');
        if (timeField && timeField.length >= 8) {
          const timeView = new DataView(timeField.buffer, timeField.byteOffset, timeField.byteLength);
          const time: Time = {
            sec: timeView.getUint32(0, true),
            nsec: timeView.getUint32(4, true),
          };
          if (!messageIndices.has(conn)) {
            messageIndices.set(conn, []);
          }
          messageIndices.get(conn)!.push({ time, offset });
          if (!hasMessages || timeLessThan(time, startTime)) startTime = time;
          if (!hasMessages || timeGreaterThan(time, endTime)) endTime = time;
          hasMessages = true;
        }
      }

      offset += record.totalLen;
    } catch {
      break; // truncated record
    }
  }

  if (!hasMessages) {
    startTime = { sec: 0, nsec: 0 };
    endTime = { sec: 0, nsec: 0 };
  }

  return { connections, messageIndices, startTime, endTime };
}

// --- Build index records ---

function buildIndexDataRecord(conn: number, entries: IndexEntry[]): Uint8Array {
  const headerFields: [string, Uint8Array][] = [
    ['op', uint8(OP_INDEX_DATA)],
    ['ver', uint32Bytes(1)],
    ['conn', uint32Bytes(conn)],
    ['count', uint32Bytes(entries.length)],
  ];
  // Data: repeated (time: 8 bytes, offset: 4 bytes) = 12 bytes each
  const data = new Uint8Array(entries.length * 12);
  for (let i = 0; i < entries.length; i++) {
    writeTime(data, i * 12, entries[i].time);
    writeUint32(data, i * 12 + 8, entries[i].offset);
  }
  return buildRecord(headerFields, data);
}

function buildConnectionRecord(connData: ConnectionData): Uint8Array {
  // Rebuild the connection record using original header and data
  const record = new Uint8Array(4 + connData.headerBytes.length + 4 + connData.dataBytes.length);
  writeUint32(record, 0, connData.headerBytes.length);
  record.set(connData.headerBytes, 4);
  writeUint32(record, 4 + connData.headerBytes.length, connData.dataBytes.length);
  record.set(connData.dataBytes, 4 + connData.headerBytes.length + 4);
  return record;
}

function buildChunkInfoRecord(
  chunkPos: number,
  startTime: Time,
  endTime: Time,
  connectionCounts: Map<number, number>,
): Uint8Array {
  const headerFields: [string, Uint8Array][] = [
    ['op', uint8(OP_CHUNK_INFO)],
    ['ver', uint32Bytes(1)],
    ['chunk_pos', uint64Bytes(chunkPos)],
    ['start_time', timeBytes(startTime)],
    ['end_time', timeBytes(endTime)],
    ['count', uint32Bytes(connectionCounts.size)],
  ];
  // Data: repeated (conn: 4 bytes, count: 4 bytes) = 8 bytes each
  const data = new Uint8Array(connectionCounts.size * 8);
  let i = 0;
  for (const [conn, count] of connectionCounts) {
    writeUint32(data, i * 8, conn);
    writeUint32(data, i * 8 + 4, count);
    i++;
  }
  return buildRecord(headerFields, data);
}

function buildBagHeaderRecord(indexPos: number, connCount: number, chunkCount: number): Uint8Array {
  const headerFields: [string, Uint8Array][] = [
    ['op', uint8(OP_BAG_HEADER)],
    ['index_pos', uint64Bytes(indexPos)],
    ['conn_count', uint32Bytes(connCount)],
    ['chunk_count', uint32Bytes(chunkCount)],
  ];
  const headerBytes = buildHeaderBytes(headerFields);

  // The bag header record (starting from offset 13 after preamble) must be
  // padded so that total file offset after it = 4096.
  // Record size = 4 (headerLen) + headerLen + 4 (dataLen) + dataLen
  // Total: 13 + 4 + headerLen + 4 + dataLen = 4096
  // dataLen = 4096 - 13 - 4 - headerLen - 4 = 4075 - headerLen
  const dataLen = 4075 - headerBytes.length;
  const data = new Uint8Array(dataLen); // zero-filled padding

  const record = new Uint8Array(4 + headerBytes.length + 4 + data.length);
  writeUint32(record, 0, headerBytes.length);
  record.set(headerBytes, 4);
  writeUint32(record, 4 + headerBytes.length, data.length);
  record.set(data, 4 + headerBytes.length + 4);
  return record;
}

// --- Main reindex function ---

export function reindexBagFromBuffer(
  buffer: ArrayBuffer,
  decompress: Decompress,
): Blob {
  const data = new Uint8Array(buffer);

  // Verify preamble
  const preamble = new TextDecoder().decode(data.subarray(0, PREAMBLE_LENGTH));
  if (preamble !== PREAMBLE) {
    throw new Error('Not a valid ROS bag file');
  }

  // Read bag header to confirm it's unindexed (or we can reindex anyway)
  const bagHeaderRecord = readRawRecord(data, PREAMBLE_LENGTH);
  const bagHeaderFields = extractFields(bagHeaderRecord.header);
  const bagOp = getOpCode(bagHeaderFields);
  if (bagOp !== OP_BAG_HEADER) {
    throw new Error('Expected bag header record');
  }

  // Scan all chunks after the bag header
  // The bag header record has variable padding, so compute end from actual record size
  let pos = PREAMBLE_LENGTH + bagHeaderRecord.totalLen;
  const chunks: ChunkScanResult[] = [];
  const allConnections = new Map<number, ConnectionData>();

  while (pos < data.length) {
    try {
      const record = readRawRecord(data, pos);
      const fields = extractFields(record.header);
      const op = getOpCode(fields);

      if (op === OP_CHUNK) {
        const compression = getStringField(fields, 'compression');
        const size = getUint32Field(fields, 'size');

        let chunkData: Uint8Array;
        if (compression === 'none' || compression === '') {
          chunkData = record.data;
        } else {
          const decompressFn = decompress[compression];
          if (!decompressFn) {
            throw new Error(`Unsupported compression: ${compression}`);
          }
          chunkData = decompressFn(record.data, size);
        }

        const scanResult = scanChunkData(chunkData);

        chunks.push({
          chunkOffset: pos,
          chunkRawBytes: data.subarray(pos, pos + record.totalLen),
          connections: scanResult.connections,
          messageIndices: scanResult.messageIndices,
          startTime: scanResult.startTime,
          endTime: scanResult.endTime,
        });

        // Collect all connections
        for (const [connId, connInfo] of scanResult.connections) {
          if (!allConnections.has(connId)) {
            allConnections.set(connId, connInfo);
          }
        }
      }
      // Skip IndexData, ChunkInfo, Connection records at top level

      pos += record.totalLen;
    } catch {
      break; // truncated data at end of file
    }
  }

  if (chunks.length === 0) {
    throw new Error('No chunks found in bag file');
  }

  // Build new file:
  // 1. Preamble
  // 2. Bag header (placeholder, will be patched)
  // 3. For each chunk: original chunk bytes + IndexData records
  // 4. Connection records
  // 5. ChunkInfo records
  // 6. Patch bag header with correct index_pos

  const parts: Uint8Array[] = [];

  // 1. Preamble
  const preambleBytes = new TextEncoder().encode(PREAMBLE);
  parts.push(preambleBytes);

  // 2. Bag header (placeholder - will be replaced at the end)
  const placeholderBagHeader = buildBagHeaderRecord(0, allConnections.size, chunks.length);
  parts.push(placeholderBagHeader);

  // Track new chunk positions for ChunkInfo records
  const newChunkPositions: number[] = [];
  let currentOffset = PREAMBLE_LENGTH + placeholderBagHeader.length;

  // 3. Chunks + IndexData
  for (const chunk of chunks) {
    newChunkPositions.push(currentOffset);

    // Copy original chunk record
    parts.push(chunk.chunkRawBytes);
    currentOffset += chunk.chunkRawBytes.length;

    // Write IndexData records for each connection in this chunk
    for (const [conn, entries] of chunk.messageIndices) {
      // Ensure index entries are sorted by timestamp (and offset for ties)
      const sortedEntries = [...entries].sort((a, b) => {
        if (a.time.sec !== b.time.sec) return a.time.sec - b.time.sec;
        if (a.time.nsec !== b.time.nsec) return a.time.nsec - b.time.nsec;
        return a.offset - b.offset;
      });
      const indexRecord = buildIndexDataRecord(conn, sortedEntries);
      parts.push(indexRecord);
      currentOffset += indexRecord.length;
    }
  }

  // 4. Connection records (at indexPosition)
  const indexPosition = currentOffset;
  for (const connData of allConnections.values()) {
    const connRecord = buildConnectionRecord(connData);
    parts.push(connRecord);
    currentOffset += connRecord.length;
  }

  // 5. ChunkInfo records
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const connectionCounts = new Map<number, number>();
    for (const [conn, entries] of chunk.messageIndices) {
      connectionCounts.set(conn, entries.length);
    }
    const chunkInfoRecord = buildChunkInfoRecord(
      newChunkPositions[i],
      chunk.startTime,
      chunk.endTime,
      connectionCounts,
    );
    parts.push(chunkInfoRecord);
  }

  // 6. Assemble and patch bag header
  const totalSize = parts.reduce((sum, p) => sum + p.length, 0);
  const output = new Uint8Array(totalSize);
  let writeOffset = 0;
  for (const part of parts) {
    output.set(part, writeOffset);
    writeOffset += part.length;
  }

  // Patch bag header with correct indexPosition
  const finalBagHeader = buildBagHeaderRecord(indexPosition, allConnections.size, chunks.length);
  output.set(finalBagHeader, PREAMBLE_LENGTH);

  return new Blob([output], { type: 'application/octet-stream' });
}

