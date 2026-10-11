import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export type SqlJsModule = Awaited<ReturnType<typeof initSqlJs>>;

/** Copied to the build output root when `VITE_ENABLE_LLM=1` (see vite.config.ts). */
export const SQL_THIRD_PARTY_LICENSES_URL = './THIRD_PARTY_LICENSES.md';

let sqlModulePromise: Promise<SqlJsModule> | null = null;

/**
 * Lazily initializes sql.js with the bundled wasm (no CDN fetch).
 */
export function initSqlEngine(): Promise<SqlJsModule> {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => (file.endsWith('.wasm') ? wasmUrl : wasmUrl),
    });
  }
  return sqlModulePromise;
}
