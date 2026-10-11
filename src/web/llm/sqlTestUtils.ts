import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import type { SqlJsModule } from './sqlEngine';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');

let testSqlModule: SqlJsModule | null = null;

export async function getTestSqlModule(): Promise<SqlJsModule> {
  if (!testSqlModule) {
    testSqlModule = await initSqlJs({
      locateFile: (file) => (file.endsWith('.wasm') ? wasmPath : wasmPath),
    });
  }
  return testSqlModule;
}
