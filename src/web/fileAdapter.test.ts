import { describe, it, expect } from 'vitest';
import { fileToBagSource } from './fileAdapter';

describe('fileToBagSource', () => {
  it('wraps a File as a lazy BagSource with matching name and size', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], 'sample.bag');
    const source = fileToBagSource(file);
    expect(source.name).toBe('sample.bag');
    expect(source.size).toBe(4);
  });

  it('reads byte ranges via Blob.slice without loading the whole file', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const file = new File([bytes], 'sample.bag');
    const source = fileToBagSource(file);
    const slice = await source.read(1, 3);
    expect(Array.from(slice)).toEqual([20, 30, 40]);
  });
});
