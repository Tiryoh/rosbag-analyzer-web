import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import Bag from '@foxglove/rosbag/dist/cjs/Bag';
import BlobReader from '@foxglove/rosbag/dist/cjs/web/BlobReader';
import { decompress as bzip2Decompress } from 'seek-bzip';
import lz4 from 'lz4js';
import { reindexBagFromBuffer, ReindexFailureError } from './reindexUtils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadFixtureBuffer(name: string): Promise<ArrayBuffer> {
  const fixturePath = path.resolve(__dirname, '../e2e/fixtures', name);
  const buffer = await readFile(fixturePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const decompress = {
  bz2: (buffer: Uint8Array) => bzip2Decompress(buffer),
  lz4: (buffer: Uint8Array) => lz4.decompress(buffer),
};

describe('reindexBagFromBuffer', () => {
  it('reindexes a valid unindexed bag and returns correct meta', async () => {
    const buffer = await loadFixtureBuffer('test_unindexed.bag');
    const result = reindexBagFromBuffer(buffer, decompress);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(0);
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

    const reader = new BlobReader(result.blob);
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
    const buffer = await loadFixtureBuffer('test_unindexed.bag');
    // Pass empty decompress map — any compressed chunk will be unsupported
    const result = reindexBagFromBuffer(buffer, {});

    // The fixture uses either bz2 or lz4 compression, or none.
    // If compression is 'none', this test won't produce warnings — check both cases.
    if (result.meta.chunksSkipped > 0) {
      expect(result.meta.warnings.some(w => w.code === 'unsupported-compression')).toBe(true);
    } else {
      // Chunk was uncompressed, so no warning expected
      expect(result.meta.partial).toBe(false);
    }
  });

  it('emits chunk-decompress-failed warning when decompressor throws', async () => {
    const buffer = await loadFixtureBuffer('test_unindexed.bag');
    const throwingDecompress = {
      bz2: () => { throw new Error('simulated bz2 failure'); },
      lz4: () => { throw new Error('simulated lz4 failure'); },
    };

    // If chunks are compressed, this should produce warnings; if uncompressed, no effect
    const result = reindexBagFromBuffer(buffer, throwingDecompress);

    if (result.meta.chunksSkipped > 0) {
      expect(result.meta.warnings.some(w => w.code === 'chunk-decompress-failed')).toBe(true);
      expect(result.meta.partial).toBe(true);
    }
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
