/**
 * Browser-only helpers for bridging the DOM File API to the core bag loaders
 * (which operate on a platform-agnostic `BagSource`).
 *
 * Keeping these shims out of `rosbagUtils.ts` / `mcapUtils.ts` lets the core
 * parsing logic run in Node / workers / future TUI contexts without depending
 * on `document`, `Blob`, or `URL.createObjectURL`.
 */
import type { BagSource } from '../core/types';

/**
 * Wrap a DOM `File` as a `BagSource`. The underlying `File` is not loaded into
 * memory: `read(offset, length)` calls `file.slice(...).arrayBuffer()` which
 * the browser implements as a lazy range read. This lets multi-GB bags be
 * parsed with peak memory proportional to the chunk being parsed, not the
 * whole file.
 */
export function fileToBagSource(file: File): BagSource {
  return {
    name: file.name,
    size: file.size,
    read: async (offset, length) => {
      const buf = await file.slice(offset, offset + length).arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}

/** Download serialized content (CSV/JSON/TXT/Parquet) as a file. */
export function downloadFile(content: string | Uint8Array, filename: string, type: string) {
  const blob = new Blob([content as BlobPart], { type });
  downloadBlob(blob, filename);
}

/** Download an existing Blob (e.g. reindexed bag) as a file. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Convenience for downloading raw bytes (e.g. a reindexed bag) as a file. */
export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/octet-stream') {
  downloadBlob(new Blob([bytes as BlobPart], { type }), filename);
}
