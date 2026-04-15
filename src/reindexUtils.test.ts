import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import Bag from '@foxglove/rosbag/dist/cjs/Bag';
import { decompress as bzip2Decompress } from 'seek-bzip';
import lz4 from 'lz4js';
import { reindexBagFromBuffer, ReindexFailureError } from './reindexUtils';

// Minimal in-memory Filelike for the rosbag `Bag` class, used to verify that
// reindexed byte output is itself openable. Mirrors the reader used inside
// rosbagUtils.ts, kept inline so the test has no web-only imports.
class Uint8ArrayReader {
  constructor(private readonly bytes: Uint8Array) {}
  read(offset: number, length: number): Promise<Uint8Array> {
    return Promise.resolve(this.bytes.subarray(offset, offset + length));
  }
  size(): number {
    return this.bytes.byteLength;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREAMBLE = '#ROSBAG V2.0\n';
const PREAMBLE_LENGTH = 13;
const OP_MESSAGE_DATA = 0x02;
const OP_BAG_HEADER = 0x03;
const OP_CHUNK = 0x05;
const OP_CONNECTION = 0x07;
const textEncoder = new TextEncoder();

interface RawRecord {
  header: Uint8Array;
  data: Uint8Array;
  totalLen: number;
}

interface ParsedChunkRecord extends RawRecord {
  fields: Map<string, Uint8Array>;
  bytes: Uint8Array;
}

async function loadFixtureBuffer(name: string): Promise<ArrayBuffer> {
  const fixturePath = path.resolve(__dirname, '../e2e/fixtures', name);
  const buffer = await readFile(fixturePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function writeUint32(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, true);
}

function writeUint64(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, (value / 0x100000000) >>> 0, true);
}

function buildHeaderBytes(fields: [string, Uint8Array][]): Uint8Array {
  const encodedKeys = fields.map(([key]) => textEncoder.encode(key));
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
    buf[offset] = 0x3d;
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

function extractFields(header: Uint8Array): Map<string, Uint8Array> {
  const fields = new Map<string, Uint8Array>();
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  let offset = 0;
  while (offset + 4 <= header.length) {
    const fieldLen = view.getUint32(offset, true);
    offset += 4;
    if (fieldLen === 0 || offset + fieldLen > header.length) break;
    const fieldBytes = header.subarray(offset, offset + fieldLen);
    const eqIdx = fieldBytes.indexOf(0x3d);
    if (eqIdx >= 0) {
      const key = Buffer.from(fieldBytes.subarray(0, eqIdx)).toString('utf8');
      fields.set(key, fieldBytes.subarray(eqIdx + 1));
    }
    offset += fieldLen;
  }
  return fields;
}

function readRawRecord(data: Uint8Array, offset: number): RawRecord {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLen = view.getUint32(offset, true);
  const header = data.subarray(offset + 4, offset + 4 + headerLen);
  const dataLen = view.getUint32(offset + 4 + headerLen, true);
  const recordData = data.subarray(offset + 4 + headerLen + 4, offset + 4 + headerLen + 4 + dataLen);
  return {
    header,
    data: recordData,
    totalLen: 4 + headerLen + 4 + dataLen,
  };
}

function buildBagHeaderRecord(indexPos: number, connCount: number, chunkCount: number): Uint8Array {
  const headerFields: [string, Uint8Array][] = [
    ['op', uint8(OP_BAG_HEADER)],
    ['index_pos', uint64Bytes(indexPos)],
    ['conn_count', uint32Bytes(connCount)],
    ['chunk_count', uint32Bytes(chunkCount)],
  ];
  const headerBytes = buildHeaderBytes(headerFields);
  const dataLen = 4075 - headerBytes.length;
  const data = new Uint8Array(dataLen);
  const record = new Uint8Array(4 + headerBytes.length + 4 + data.length);
  writeUint32(record, 0, headerBytes.length);
  record.set(headerBytes, 4);
  writeUint32(record, 4 + headerBytes.length, data.length);
  record.set(data, 4 + headerBytes.length + 4);
  return record;
}

function buildChunkRecord(chunkData: Uint8Array, compression: string, size = chunkData.length): Uint8Array {
  return buildRecord([
    ['op', uint8(OP_CHUNK)],
    ['compression', textEncoder.encode(compression)],
    ['size', uint32Bytes(size)],
  ], chunkData);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function buildUnindexedBag(chunks: Array<{ chunkData: Uint8Array; compression: string; size?: number }>): ArrayBuffer {
  const preambleBytes = textEncoder.encode(PREAMBLE);
  const bagHeader = buildBagHeaderRecord(0, 0, 0);
  const chunkRecords = chunks.map(({ chunkData, compression, size }) => buildChunkRecord(chunkData, compression, size));
  return toArrayBuffer(concatBytes([preambleBytes, bagHeader, ...chunkRecords]));
}

function parseFixtureChunkRecords(buffer: ArrayBuffer): ParsedChunkRecord[] {
  const data = new Uint8Array(buffer);
  const bagHeader = readRawRecord(data, PREAMBLE_LENGTH);
  const chunkRecord = readRawRecord(data, PREAMBLE_LENGTH + bagHeader.totalLen);
  const records: ParsedChunkRecord[] = [];

  let offset = 0;
  while (offset < chunkRecord.data.length) {
    const record = readRawRecord(chunkRecord.data, offset);
    const fields = extractFields(record.header);
    records.push({
      ...record,
      fields,
      bytes: chunkRecord.data.slice(offset, offset + record.totalLen),
    });
    offset += record.totalLen;
  }

  return records;
}

function getOpCode(fields: Map<string, Uint8Array>): number {
  const op = fields.get('op');
  return op?.[0] ?? -1;
}

function getConnId(fields: Map<string, Uint8Array>): number | undefined {
  const conn = fields.get('conn');
  if (!conn || conn.length < 4) return undefined;
  return new DataView(conn.buffer, conn.byteOffset, conn.byteLength).getUint32(0, true);
}

function pickChunkRecord(records: ParsedChunkRecord[], op: number, conn: number): Uint8Array {
  const record = records.find((candidate) => getOpCode(candidate.fields) === op && getConnId(candidate.fields) === conn);
  expect(record).toBeDefined();
  return record!.bytes.slice();
}

const decompress = {
  bz2: (buffer: Uint8Array) => bzip2Decompress(buffer),
  lz4: (buffer: Uint8Array) => lz4.decompress(buffer),
};

describe('reindexBagFromBuffer', () => {
  it('reindexes a valid unindexed bag and returns correct meta', async () => {
    const buffer = await loadFixtureBuffer('test_unindexed.bag');
    const result = reindexBagFromBuffer(buffer, decompress);

    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.meta).toMatchObject({
      partial: false,
      chunksSkipped: 0,
    });
    expect(result.meta.chunksSeen).toBeGreaterThanOrEqual(1);
    expect(result.meta.chunksRecovered).toBe(result.meta.chunksSeen);
    expect(result.meta.warnings).toHaveLength(0);
    expect(result.meta.messagesIndexedApprox).toBeGreaterThan(0);
  });

  it('produces a bag that can be opened and read by @foxglove/rosbag', async () => {
    const buffer = await loadFixtureBuffer('test_unindexed.bag');
    const result = reindexBagFromBuffer(buffer, decompress);

    const reader = new Uint8ArrayReader(result.bytes);
    const bag = new Bag(reader, {
      decompress: {
        bz2: (buf: Uint8Array) => bzip2Decompress(buf),
        lz4: (buf: Uint8Array) => lz4.decompress(buf),
      },
    });
    await bag.open();

    expect(bag.header).toBeDefined();
    expect(bag.header!.indexPosition).toBeGreaterThan(0);
    expect(bag.connections.size).toBeGreaterThan(0);

    let messageCount = 0;
    await bag.readMessages({}, () => { messageCount++; });
    expect(messageCount).toBeGreaterThan(0);
  });

  it('throws for non-bag input', async () => {
    const garbage = new TextEncoder().encode('not a rosbag file at all');
    expect(() => reindexBagFromBuffer(garbage.buffer, decompress)).toThrow('Not a valid ROS bag file');
  });

  it('throws ReindexFailureError for truncated bag with no recoverable chunks', async () => {
    const buffer = await loadFixtureBuffer('test_truncated.bag');
    expect(() => reindexBagFromBuffer(buffer, decompress)).toThrow(ReindexFailureError);
  });

  it('includes blocker details in ReindexFailureError', async () => {
    const buffer = await loadFixtureBuffer('test_truncated.bag');
    try {
      reindexBagFromBuffer(buffer, decompress);
      expect.fail('Expected reindexBagFromBuffer to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ReindexFailureError);
      const failure = error as ReindexFailureError;
      expect(failure.blockers.length).toBeGreaterThan(0);
      expect(failure.blockers.some(w => w.code === 'truncated-tail')).toBe(true);
    }
  });

  it('emits unsupported-compression warning when decompress map lacks the algorithm', async () => {
    const fixture = await loadFixtureBuffer('test_unindexed.bag');
    const records = parseFixtureChunkRecords(fixture);
    const validChunkData = concatBytes([
      pickChunkRecord(records, OP_CONNECTION, 0),
      pickChunkRecord(records, OP_MESSAGE_DATA, 0),
    ]);
    const fakeCompressedChunkData = pickChunkRecord(records, OP_CONNECTION, 1);
    const buffer = buildUnindexedBag([
      { chunkData: validChunkData, compression: 'none' },
      { chunkData: fakeCompressedChunkData, compression: 'mystery', size: fakeCompressedChunkData.length },
    ]);

    const result = reindexBagFromBuffer(buffer, {});

    expect(result.meta.partial).toBe(true);
    expect(result.meta.chunksSkipped).toBe(1);
    expect(result.meta.warnings.some(w => w.code === 'unsupported-compression')).toBe(true);
  });

  it('emits chunk-decompress-failed warning when decompressor throws', async () => {
    const fixture = await loadFixtureBuffer('test_unindexed.bag');
    const records = parseFixtureChunkRecords(fixture);
    const validChunkData = concatBytes([
      pickChunkRecord(records, OP_CONNECTION, 0),
      pickChunkRecord(records, OP_MESSAGE_DATA, 0),
    ]);
    const fakeCompressedChunkData = pickChunkRecord(records, OP_CONNECTION, 1);
    const buffer = buildUnindexedBag([
      { chunkData: validChunkData, compression: 'none' },
      { chunkData: fakeCompressedChunkData, compression: 'mystery', size: fakeCompressedChunkData.length },
    ]);

    const result = reindexBagFromBuffer(buffer, {
      mystery: () => {
        throw new Error('simulated decompressor failure');
      },
    });

    expect(result.meta.partial).toBe(true);
    expect(result.meta.chunksSkipped).toBe(1);
    expect(result.meta.warnings.some(w => w.code === 'chunk-decompress-failed')).toBe(true);
  });

  it('skips connections whose metadata cannot be recovered and still produces a readable bag', async () => {
    const fixture = await loadFixtureBuffer('test_unindexed.bag');
    const records = parseFixtureChunkRecords(fixture);
    const skippedMetadataChunk = pickChunkRecord(records, OP_CONNECTION, 1);
    const mixedChunkData = concatBytes([
      pickChunkRecord(records, OP_CONNECTION, 0),
      pickChunkRecord(records, OP_MESSAGE_DATA, 0),
      pickChunkRecord(records, OP_MESSAGE_DATA, 1),
    ]);
    const buffer = buildUnindexedBag([
      { chunkData: skippedMetadataChunk, compression: 'mystery', size: skippedMetadataChunk.length },
      { chunkData: mixedChunkData, compression: 'none' },
    ]);

    const result = reindexBagFromBuffer(buffer, {});

    expect(result.meta.partial).toBe(true);
    expect(result.meta.warnings.some(w => w.code === 'missing-connection-metadata')).toBe(true);

    const reader = new Uint8ArrayReader(result.bytes);
    const bag = new Bag(reader, {});
    await bag.open();

    expect(bag.connections.size).toBe(1);

    let messageCount = 0;
    await bag.readMessages({}, () => {
      messageCount++;
    });

    expect(messageCount).toBe(1);
  });

  it('emits chunk-record-corrupt warning for garbage bytes inside a chunk', async () => {
    const fixture = await loadFixtureBuffer('test_unindexed.bag');
    const records = parseFixtureChunkRecords(fixture);
    // Build a chunk with valid records followed by non-zero garbage
    const validRecords = concatBytes([
      pickChunkRecord(records, OP_CONNECTION, 0),
      pickChunkRecord(records, OP_MESSAGE_DATA, 0),
    ]);
    const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]);
    const corruptChunkData = concatBytes([validRecords, garbage]);

    const buffer = buildUnindexedBag([
      { chunkData: corruptChunkData, compression: 'none' },
    ]);

    const result = reindexBagFromBuffer(buffer, decompress);

    expect(result.meta.partial).toBe(true);
    expect(result.meta.warnings.some(w => w.code === 'chunk-record-corrupt')).toBe(true);
    expect(result.meta.chunksRecovered).toBe(1);
    expect(result.meta.messagesIndexedApprox).toBeGreaterThan(0);
  });

  it('reports partial when tail bytes are appended', async () => {
    const buffer = await loadFixtureBuffer('test_unindexed.bag');
    const original = new Uint8Array(buffer);
    const corrupted = new Uint8Array(original.length + 3);
    corrupted.set(original, 0);
    corrupted.set([0xde, 0xad, 0xbe], original.length);

    const result = reindexBagFromBuffer(corrupted.buffer, decompress);

    expect(result.meta.partial).toBe(true);
    expect(result.meta.warnings.some(w => w.code === 'truncated-tail')).toBe(true);
    expect(result.meta.chunksRecovered).toBeGreaterThan(0);
  });
});
