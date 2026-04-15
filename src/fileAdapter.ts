/**
 * Browser-only helpers for bridging the DOM File API to the core bag loaders
 * (which operate on a platform-agnostic `BagSource`).
 *
 * Keeping these shims out of `rosbagUtils.ts` / `mcapUtils.ts` lets the core
 * parsing logic run in Node / workers / future TUI contexts without depending
 * on `document`, `Blob`, or `URL.createObjectURL`.
 */
import type { BagSource } from './types';

/**
 * Read a DOM `File` into a `BagSource`. Wraps large-file read failures so the
 * UI can show a helpful memory-pressure message instead of a raw DOMException.
 */
export async function fileToBagSource(file: File): Promise<BagSource> {
  try {
    const buffer = await file.arrayBuffer();
    return { name: file.name, data: new Uint8Array(buffer) };
  } catch (err) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(0);
    if (file.size > 512 * 1024 * 1024 && err instanceof DOMException && err.name === 'NotReadableError') {
      throw new Error(
        `Failed to read file (${sizeMB} MB). The file is too large to load into browser memory.\n\n` +
        'Try splitting the file into smaller parts or using a command-line tool.'
      );
    }
    throw err;
  }
}

/** Download serialized content (CSV/JSON/TXT/Parquet) as a file. */
export function downloadFile(content: string | Uint8Array, filename: string, type: string) {
  const blob = new Blob([content as unknown as BlobPart], { type });
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
  downloadBlob(new Blob([bytes as unknown as BlobPart], { type }), filename);
}
