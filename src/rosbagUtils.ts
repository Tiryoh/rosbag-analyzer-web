import Bag from '@foxglove/rosbag/dist/cjs/Bag';
import BlobReader from '@foxglove/rosbag/dist/cjs/web/BlobReader';
import { decompress as bzip2Decompress } from 'seek-bzip';
import lz4 from 'lz4js';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { RosoutMessage, DiagnosticStatusEntry, SeverityLevel } from './types';
import { DIAGNOSTIC_LEVEL_NAMES, ROS1_SEVERITY } from './types';

type Timezone = 'local' | 'utc';

type BagConnectionView = {
  topic: string;
  type?: string;
};

type BagTimestamp = {
  sec: number;
  nsec: number;
};

type RosoutPayload = {
  level?: number;
  msg?: string;
  name?: string;
  file?: string;
  line?: number;
  function?: string;
  topics?: string[];
};

type DiagnosticValuePayload = {
  key?: string;
  value?: string;
};

type DiagnosticStatusPayload = {
  name?: string;
  level?: number;
  message?: string;
  values?: DiagnosticValuePayload[];
};

type DiagnosticArrayPayload = {
  status?: DiagnosticStatusPayload[];
};

type ReadMessageResult<T> = {
  message: T;
  timestamp: BagTimestamp;
};

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function resolveNodeFilePath(fileUrl: URL): string {
  if (fileUrl.protocol !== 'file:') {
    return fileUrl.toString();
  }

  const pathname = decodeURIComponent(fileUrl.pathname);
  return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
}

const resolvedSqlWasmUrl =
  typeof window === 'undefined'
    ? resolveNodeFilePath(new URL('../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url))
    : sqlWasmUrl;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: () => resolvedSqlWasmUrl,
    });
  }
  return sqlJsPromise;
}

export async function loadRosbagMessages(file: File): Promise<{
  messages: RosoutMessage[];
  uniqueNodes: Set<string>;
  diagnostics: DiagnosticStatusEntry[];
  hasDiagnostics: boolean;
}> {
  const messages: RosoutMessage[] = [];
  const uniqueNodes = new Set<string>();

  console.log('=== Starting ROSbag load ===');
  console.log('File name:', file.name);
  console.log('File size:', file.size, 'bytes');
  console.log('File type:', file.type);

  try {
    console.log('Reading file as ArrayBuffer...');
    const arrayBuffer = await file.arrayBuffer();
    console.log('ArrayBuffer loaded, size:', arrayBuffer.byteLength);

    // Check bag file header
    const headerView = new Uint8Array(arrayBuffer, 0, Math.min(100, arrayBuffer.byteLength));
    const headerStr = new TextDecoder().decode(headerView.slice(0, 13));
    console.log('Bag file header:', headerStr);
    console.log('First 20 bytes:', Array.from(headerView.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));

    console.log('Creating BlobReader...');
    const reader = new BlobReader(new Blob([arrayBuffer]));

    console.log('Initializing decompression handlers...');

    console.log('Creating Bag with decompression support...');
    const bag = new Bag(reader, {
      decompress: {
        bz2: (buffer: Uint8Array) => {
          console.log('Decompressing bz2 chunk, size:', buffer.length);
          return bzip2Decompress(buffer);
        },
        lz4: (buffer: Uint8Array) => {
          console.log('Decompressing lz4 chunk, size:', buffer.length);
          return lz4.decompress(buffer);
        },
      },
    });

    console.log('Opening bag with BlobReader...');
    await bag.open();
    console.log('✓ Bag opened successfully');

    console.log('Bag header:', bag.header);
    console.log('Start time:', bag.startTime);
    console.log('End time:', bag.endTime);
    console.log('Connections count:', bag.connections.size);
    console.log('Chunk infos count:', bag.chunkInfos.length);

    // Check if bag is indexed
    if (bag.header && bag.header.indexPosition === 0 && bag.header.connectionCount === 0 && bag.header.chunkCount === 0) {
      throw new Error(
        '❌ このbagファイルはインデックス化されていないため、ブラウザ上で読み込めません。\n\n' +
        '🔧 解決方法:\n' +
        'ターミナルで以下のコマンドを実行してください:\n\n' +
        `  rosbag reindex ${file.name}\n\n` +
        'これによりインデックス付きバージョンが作成され、ブラウザで解析できるようになります。\n\n' +
        '💡 ヒント: reindexされたファイルは元のファイル名に ".orig" が追加されます。'
      );
    }

    // Find rosout and diagnostics topics
    console.log('Searching for rosout and diagnostics topics...');
    const rosoutTopics: string[] = [];
    const diagnosticsTopics: string[] = [];
    for (const [connId, conn] of bag.connections) {
      console.log(`  Connection ${connId}: Topic: ${conn.topic}, Type: ${conn.type}`);
      if (conn.topic.includes('rosout') || conn.type === 'rosgraph_msgs/Log') {
        rosoutTopics.push(conn.topic);
        console.log(`    ✓ Found rosout topic: ${conn.topic}`);
      }
      if (conn.topic.includes('diagnostics') || conn.type === 'diagnostic_msgs/DiagnosticArray') {
        diagnosticsTopics.push(conn.topic);
        console.log(`    ✓ Found diagnostics topic: ${conn.topic}`);
      }
    }

    console.log('Total rosout topics found:', rosoutTopics.length);
    console.log('Total diagnostics topics found:', diagnosticsTopics.length);

    if (rosoutTopics.length === 0 && diagnosticsTopics.length === 0) {
      const availableTopics = Array.from(bag.connections.values())
        .map((conn: BagConnectionView) => `  - ${conn.topic} [${conn.type ?? 'unknown'}]`)
        .join('\n');

      throw new Error(
        `No rosout or diagnostics topics found in bag file.\n\nAvailable topics:\n${availableTopics}\n\n` +
        `Looking for topics containing 'rosout' or 'diagnostics' (e.g. '/diagnostics' or '/diagnostics_agg') or of type 'diagnostic_msgs/DiagnosticArray'`
      );
    }

    const decompressOptions = {
      bz2: (buffer: Uint8Array) => bzip2Decompress(buffer),
      lz4: (buffer: Uint8Array) => lz4.decompress(buffer),
    };

    // Read rosout messages
    if (rosoutTopics.length > 0) {
      console.log('Reading rosout messages from topics:', rosoutTopics);
      let messageCount = 0;

      await bag.readMessages(
        { topics: rosoutTopics, decompress: decompressOptions },
        (result: ReadMessageResult<RosoutPayload>) => {
          messageCount++;
          if (messageCount % 100 === 0) {
            console.log(`  Processing rosout message ${messageCount}...`);
          }

          const msg = result.message;

          if (msg && msg.level !== undefined && msg.msg !== undefined) {
            const rosoutMsg: RosoutMessage = {
              timestamp: result.timestamp.sec + result.timestamp.nsec / 1e9,
              node: msg.name || 'unknown',
              severity: ROS1_SEVERITY[msg.level] ?? 'DEBUG',
              message: msg.msg,
              file: msg.file || '',
              line: msg.line || 0,
              function: msg.function || '',
              topics: msg.topics || [],
            };

            messages.push(rosoutMsg);
            if (msg.name) {
              uniqueNodes.add(msg.name);
            }
          }
        }
      );
      console.log(`✓ Successfully loaded ${messages.length} rosout messages from ${uniqueNodes.size} nodes`);
    }

    // Read diagnostics messages (state-change only)
    const diagnostics: DiagnosticStatusEntry[] = [];
    const hasDiagnostics = diagnosticsTopics.length > 0;

    if (hasDiagnostics) {
      console.log('Reading diagnostics messages from topics:', diagnosticsTopics);
      const lastState = new Map<string, { level: number; message: string }>();

      await bag.readMessages(
        { topics: diagnosticsTopics, decompress: decompressOptions },
        (result: ReadMessageResult<DiagnosticArrayPayload>) => {
          const msg = result.message;
          if (!msg || !msg.status) return;

          const timestamp = result.timestamp.sec + result.timestamp.nsec / 1e9;

          for (const status of msg.status) {
            const name: string = status.name || 'unknown';
            const level: number = status.level ?? 0;
            const message: string = status.message || '';
            const values: { key: string; value: string }[] = (status.values || []).map((v: DiagnosticValuePayload) => ({
              key: v.key || '',
              value: v.value || '',
            }));

            const prev = lastState.get(name);
            if (!prev || prev.level !== level || prev.message !== message) {
              lastState.set(name, { level, message });
              diagnostics.push({ timestamp, name, level, message, values });
            }
          }
        }
      );
      console.log(`✓ Successfully loaded ${diagnostics.length} diagnostics state changes`);
    }

    return { messages, uniqueNodes, diagnostics, hasDiagnostics };
  } catch (error) {
    console.error('!!! Error loading rosbag !!!');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
}

export function filterMessages(
  messages: RosoutMessage[],
  filters: {
    nodeNames?: Set<string>;
    severityLevels?: Set<SeverityLevel>;
    messageKeywords?: string[];
    messageRegex?: string;
    filterMode?: 'OR' | 'AND';
    useRegex?: boolean;
    startTime?: number;
    endTime?: number;
  }
): RosoutMessage[] {
  return messages.filter((msg) => {
    const conditions: boolean[] = [];

    // Severity filter
    if (filters.severityLevels && filters.severityLevels.size > 0) {
      conditions.push(filters.severityLevels.has(msg.severity));
    }

    // Node filter
    if (filters.nodeNames && filters.nodeNames.size > 0) {
      conditions.push(filters.nodeNames.has(msg.node));
    }

    // Message text filter (keywords or regex)
    if (filters.useRegex && filters.messageRegex && filters.messageRegex.trim()) {
      try {
        const regex = new RegExp(filters.messageRegex, 'i');
        conditions.push(regex.test(msg.message));
      } catch (e) {
        // Invalid regex, skip this filter
        console.warn('Invalid regex pattern:', filters.messageRegex);
      }
    } else if (!filters.useRegex && filters.messageKeywords && filters.messageKeywords.length > 0) {
      // Normalize keywords: trim, drop empty entries (e.g. from trailing commas), and lowercase
      const keywords = filters.messageKeywords
        .map(k => (k ?? '').toString().trim())
        .filter(k => k.length > 0)
        .map(k => k.toLowerCase());

      // If all entries were empty (e.g. user typed "," or "error,"), skip this keyword filter
      if (keywords.length > 0) {
        const messageLower = msg.message.toLowerCase();
        const hasKeyword = keywords.some(keyword => messageLower.includes(keyword));
        conditions.push(hasKeyword);
      }
    }

    // Time range filters
    if (filters.startTime !== undefined && msg.timestamp < filters.startTime) {
      return false;
    }
    if (filters.endTime !== undefined && msg.timestamp > filters.endTime) {
      return false;
    }

    // Apply filter mode (OR/AND)
    if (conditions.length === 0) {
      return true; // No filters applied
    }

    if (filters.filterMode === 'AND') {
      return conditions.every(c => c);
    } else {
      // Default to OR mode
      return conditions.some(c => c);
    }
  });
}

export function filterDiagnostics(
  diagnostics: DiagnosticStatusEntry[],
  filters: {
    levels?: Set<number>;
    names?: Set<string>;
    messageKeywords?: string;
    messageRegex?: string;
    filterMode?: 'OR' | 'AND';
    useRegex?: boolean;
  }
): DiagnosticStatusEntry[] {
  return diagnostics.filter(d => {
    const conditions: boolean[] = [];

    if (filters.levels && filters.levels.size > 0) {
      conditions.push(filters.levels.has(d.level));
    }
    if (filters.names && filters.names.size > 0) {
      conditions.push(filters.names.has(d.name));
    }
    if (filters.useRegex && filters.messageRegex && filters.messageRegex.trim()) {
      try {
        const regex = new RegExp(filters.messageRegex, 'i');
        conditions.push(regex.test(d.message));
      } catch { /* skip invalid regex */ }
    } else if (!filters.useRegex && filters.messageKeywords) {
      const keywords = filters.messageKeywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
      if (keywords.length > 0) {
        const msgLower = d.message.toLowerCase();
        conditions.push(keywords.some(kw => msgLower.includes(kw)));
      }
    }

    if (conditions.length === 0) return true;
    return filters.filterMode === 'AND' ? conditions.every(c => c) : conditions.some(c => c);
  });
}

function formatTimestamp(timestamp: number, timezone: Timezone = 'local'): string {
  const date = new Date(timestamp * 1000);
  if (timezone === 'utc') {
    return date.toISOString().replace('T', ' ').substring(0, 23) + ' UTC';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportToCSV(messages: RosoutMessage[], timezone: Timezone = 'local'): string {
  const headers = ['Timestamp','Time','Node','Severity','Message','File','Line','Function','Topics'];
  const rows = messages.map(msg => [
    msg.timestamp.toFixed(6),
    formatTimestamp(msg.timestamp, timezone),
    escapeCSV(msg.node),
    msg.severity,
    escapeCSV(msg.message),
    escapeCSV(msg.file || ''),
    String(msg.line || 0),
    escapeCSV(msg.function || ''),
    escapeCSV((msg.topics || []).join(';'))
  ]);
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

export function exportToJSON(messages: RosoutMessage[], timezone: Timezone = 'local'): string {
  const exportData = messages.map(msg => ({
    timestamp: msg.timestamp,
    time: formatTimestamp(msg.timestamp, timezone),
    node: msg.node,
    severity: msg.severity,
    message: msg.message,
    file: msg.file || '',
    line: msg.line || 0,
    function: msg.function || '',
    topics: msg.topics || []
  }));
  return JSON.stringify(exportData, null, 2);
}

export function exportToTXT(messages: RosoutMessage[], timezone: Timezone = 'local'): string {
  return messages.map(msg => {
    const time = formatTimestamp(msg.timestamp, timezone);
    const location = msg.file ? `${msg.file}:${msg.line || 0}` : '';
    let line = `[${time}] [${msg.severity}] [${msg.node}]: ${msg.message}`;
    if (location) line += ` (${location})`;
    return line;
  }).join('\n');
}

export function exportDiagnosticsToCSV(diagnostics: DiagnosticStatusEntry[], timezone: Timezone = 'local'): string {
  const headers = ['Timestamp', 'Time', 'Name', 'Level', 'Message', 'Values'];
  const rows = diagnostics.map(d => [
    d.timestamp.toFixed(6),
    formatTimestamp(d.timestamp, timezone),
    escapeCSV(d.name),
    DIAGNOSTIC_LEVEL_NAMES[d.level] || String(d.level),
    escapeCSV(d.message),
    escapeCSV(d.values.map(v => `${v.key}=${v.value}`).join('; ')),
  ]);
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

export function exportDiagnosticsToJSON(diagnostics: DiagnosticStatusEntry[], timezone: Timezone = 'local'): string {
  const exportData = diagnostics.map(d => ({
    timestamp: d.timestamp,
    time: formatTimestamp(d.timestamp, timezone),
    name: d.name,
    level: DIAGNOSTIC_LEVEL_NAMES[d.level] || d.level,
    message: d.message,
    values: d.values,
  }));
  return JSON.stringify(exportData, null, 2);
}

export function exportDiagnosticsToTXT(diagnostics: DiagnosticStatusEntry[], timezone: Timezone = 'local'): string {
  return diagnostics.map(d => {
    const time = formatTimestamp(d.timestamp, timezone);
    const level = DIAGNOSTIC_LEVEL_NAMES[d.level] || String(d.level);
    let line = `[${time}] [${level}] ${d.name}: ${d.message}`;
    if (d.values.length > 0) {
      line += ` {${d.values.map(v => `${v.key}=${v.value}`).join(', ')}}`;
    }
    return line;
  }).join('\n');
}

export async function exportToSQLite(messages: RosoutMessage[], timezone: Timezone = 'local'): Promise<Uint8Array> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE rosout_logs (
      id INTEGER PRIMARY KEY,
      timestamp REAL NOT NULL,
      time_text TEXT NOT NULL,
      node TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER NOT NULL,
      function_name TEXT NOT NULL,
      topics_text TEXT NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO rosout_logs (
      timestamp, time_text, node, severity, message, file, line, function_name, topics_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let binary: Uint8Array;
  try {
    db.run('BEGIN TRANSACTION');
    try {
      for (const msg of messages) {
        insert.run([
          msg.timestamp,
          formatTimestamp(msg.timestamp, timezone),
          msg.node,
          msg.severity,
          msg.message,
          msg.file || '',
          msg.line || 0,
          msg.function || '',
          (msg.topics || []).join(';'),
        ]);
        insert.reset();
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }

    binary = db.export();
  } finally {
    insert.free();
    db.close();
  }

  return binary;
}

export async function exportDiagnosticsToSQLite(
  diagnostics: DiagnosticStatusEntry[],
  timezone: Timezone = 'local'
): Promise<Uint8Array> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE diagnostics (
      id INTEGER PRIMARY KEY,
      timestamp REAL NOT NULL,
      time_text TEXT NOT NULL,
      name TEXT NOT NULL,
      level_code INTEGER NOT NULL,
      level_name TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE TABLE diagnostic_values (
      id INTEGER PRIMARY KEY,
      diagnostic_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      FOREIGN KEY (diagnostic_id) REFERENCES diagnostics(id)
    );
  `);

  const insertDiagnostic = db.prepare(`
    INSERT INTO diagnostics (
      timestamp, time_text, name, level_code, level_name, message
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertValue = db.prepare(`
    INSERT INTO diagnostic_values (diagnostic_id, key, value)
    VALUES (?, ?, ?)
  `);
  const selectLastInsertRowId = db.prepare('SELECT last_insert_rowid()');

  let binary: Uint8Array;
  try {
    db.run('BEGIN TRANSACTION');
    try {
      for (const diagnostic of diagnostics) {
        insertDiagnostic.run([
          diagnostic.timestamp,
          formatTimestamp(diagnostic.timestamp, timezone),
          diagnostic.name,
          diagnostic.level,
          DIAGNOSTIC_LEVEL_NAMES[diagnostic.level] || String(diagnostic.level),
          diagnostic.message,
        ]);
        insertDiagnostic.reset();

        if (!selectLastInsertRowId.step()) {
          throw new Error('Failed to read last_insert_rowid()');
        }
        const [diagnosticIdValue] = selectLastInsertRowId.get();
        const diagnosticId = Number(diagnosticIdValue);
        selectLastInsertRowId.reset();

        for (const entry of diagnostic.values) {
          insertValue.run([diagnosticId, entry.key, entry.value]);
          insertValue.reset();
        }
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }

    binary = db.export();
  } finally {
    selectLastInsertRowId.free();
    insertDiagnostic.free();
    insertValue.free();
    db.close();
  }

  return binary;
}

export async function loadMessages(file: File): Promise<{
  messages: RosoutMessage[];
  uniqueNodes: Set<string>;
  diagnostics: DiagnosticStatusEntry[];
  hasDiagnostics: boolean;
}> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mcap') || name.endsWith('.mcap.zstd')) {
    const { loadMcapMessages } = await import('./mcapUtils');
    return loadMcapMessages(file);
  }
  return loadRosbagMessages(file);
}

export function downloadFile(content: string | Uint8Array, filename: string, type: string) {
  const blob = new Blob([content as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
