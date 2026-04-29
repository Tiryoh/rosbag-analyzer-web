import { describe, it, expect } from 'vitest';
import { fileToBagSource } from './fileAdapter';

describe('fileToBagSource', () => {
  it('converts a File into a BagSource with matching bytes and name', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'sample.bag');
    const source = await fileToBagSource(file);
    expect(source.name).toBe('sample.bag');
    expect(Array.from(source.data)).toEqual([1, 2, 3, 4]);
  });

  it('wraps large-file NotReadableError with a memory-pressure message', async () => {
    const largeFile = {
      name: 'large.mcap',
      size: 1024 * 1024 * 1024, // 1 GB
      arrayBuffer: () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError')),
    } as unknown as File;
    await expect(fileToBagSource(largeFile)).rejects.toThrow(/1024 MB.*too large/);
  });

  it('does not alter the error for small files that fail to read', async () => {
    const smallFile = {
      name: 'small.bag',
      size: 1024, // 1 KB
      arrayBuffer: () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError')),
    } as unknown as File;
    await expect(fileToBagSource(smallFile)).rejects.toThrow('The requested file could not be read');
  });
});
