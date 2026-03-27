import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { filterMessages, filterDiagnostics, exportToSQLite, exportDiagnosticsToSQLite } from './rosbagUtils';
import type { RosoutMessage, DiagnosticStatusEntry, SeverityLevel } from './types';

// -- Test fixtures --

const rosoutMessages: RosoutMessage[] = [
  { timestamp: 100, node: '/node_a', severity: 'DEBUG', message: 'debug info here' },
  { timestamp: 200, node: '/node_a', severity: 'INFO', message: 'all systems go' },
  { timestamp: 300, node: '/node_b', severity: 'WARN', message: 'Warning: low battery' },
  { timestamp: 400, node: '/node_b', severity: 'ERROR', message: 'Error: connection lost' },
  { timestamp: 500, node: '/node_c', severity: 'FATAL', message: 'FATAL crash detected' },
];

const diagEntries: DiagnosticStatusEntry[] = [
  { timestamp: 100, name: '/sensor/lidar', level: 0, message: 'OK running', values: [] },
  { timestamp: 200, name: '/sensor/camera', level: 1, message: 'Warning: low fps', values: [] },
  { timestamp: 300, name: '/motor/left', level: 2, message: 'Error: overheating', values: [] },
  { timestamp: 400, name: '/motor/right', level: 3, message: 'Stale: no update', values: [] },
];

function resolveNodeFilePath(fileUrl: URL): string {
  if (fileUrl.protocol !== 'file:') {
    return fileUrl.toString();
  }

  const pathname = decodeURIComponent(fileUrl.pathname);
  return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
}

const sqlPromise = initSqlJs({
  locateFile: () => (
    typeof window === 'undefined'
      ? resolveNodeFilePath(new URL('../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url))
      : sqlWasmUrl
  ),
});

// ==================== filterMessages ====================

describe('filterMessages', () => {
  it('returns all messages when no filters applied', () => {
    expect(filterMessages(rosoutMessages, {})).toHaveLength(5);
  });

  it('returns empty array for empty input', () => {
    expect(filterMessages([], {})).toHaveLength(0);
  });

  // -- Severity --

  it('filters by single severity', () => {
    const result = filterMessages(rosoutMessages, { severityLevels: new Set<SeverityLevel>(['INFO']) });
    expect(result).toHaveLength(1);
    expect(result[0].node).toBe('/node_a');
    expect(result[0].severity).toBe('INFO');
  });

  it('filters by multiple severities', () => {
    const result = filterMessages(rosoutMessages, { severityLevels: new Set<SeverityLevel>(['WARN', 'ERROR']) });
    expect(result).toHaveLength(2);
    expect(result.every(m => ['WARN', 'ERROR'].includes(m.severity))).toBe(true);
  });

  it('empty severity set returns all', () => {
    const result = filterMessages(rosoutMessages, { severityLevels: new Set() });
    expect(result).toHaveLength(5);
  });

  // -- Node --

  it('filters by single node', () => {
    const result = filterMessages(rosoutMessages, { nodeNames: new Set(['/node_b']) });
    expect(result).toHaveLength(2);
  });

  it('filters by multiple nodes', () => {
    const result = filterMessages(rosoutMessages, { nodeNames: new Set(['/node_a', '/node_c']) });
    expect(result).toHaveLength(3);
  });

  it('non-matching node returns empty', () => {
    const result = filterMessages(rosoutMessages, { nodeNames: new Set(['/node_z']) });
    expect(result).toHaveLength(0);
  });

  // -- Keywords --

  it('filters by keyword (case insensitive)', () => {
    const result = filterMessages(rosoutMessages, {
      useRegex: false,
      messageKeywords: ['error'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('Error');
  });

  it('filters by multiple keywords (OR within keywords)', () => {
    const result = filterMessages(rosoutMessages, {
      useRegex: false,
      messageKeywords: ['debug', 'fatal'],
    });
    expect(result).toHaveLength(2);
  });

  it('ignores empty keyword entries', () => {
    const result = filterMessages(rosoutMessages, {
      useRegex: false,
      messageKeywords: ['', '  ', 'error'],
    });
    expect(result).toHaveLength(1);
  });

  it('all-empty keywords means no keyword filter (returns all)', () => {
    const result = filterMessages(rosoutMessages, {
      useRegex: false,
      messageKeywords: ['', '  '],
    });
    expect(result).toHaveLength(5);
  });

  // -- Regex --

  it('filters by valid regex', () => {
    const result = filterMessages(rosoutMessages, {
      useRegex: true,
      messageRegex: 'error.*lost',
    });
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('ERROR');
  });

  it('regex is case insensitive', () => {
    const result = filterMessages(rosoutMessages, {
      useRegex: true,
      messageRegex: 'FATAL',
    });
    expect(result).toHaveLength(1);
  });

  it('invalid regex is skipped (no filter applied)', () => {
    const result = filterMessages(rosoutMessages, {
      useRegex: true,
      messageRegex: '[invalid(',
    });
    expect(result).toHaveLength(5);
  });

  it('empty regex string means no regex filter', () => {
    const result = filterMessages(rosoutMessages, {
      useRegex: true,
      messageRegex: '   ',
    });
    expect(result).toHaveLength(5);
  });

  // -- Time range --

  it('filters by startTime', () => {
    const result = filterMessages(rosoutMessages, { startTime: 300 });
    expect(result).toHaveLength(3);
    expect(result[0].timestamp).toBe(300);
  });

  it('filters by endTime', () => {
    const result = filterMessages(rosoutMessages, { endTime: 200 });
    expect(result).toHaveLength(2);
  });

  it('filters by startTime and endTime', () => {
    const result = filterMessages(rosoutMessages, { startTime: 200, endTime: 400 });
    expect(result).toHaveLength(3);
  });

  it('returns empty when time range matches nothing', () => {
    const result = filterMessages(rosoutMessages, { startTime: 600, endTime: 700 });
    expect(result).toHaveLength(0);
  });

  // -- OR mode --

  it('OR mode: matches if any condition is true', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'OR',
      severityLevels: new Set<SeverityLevel>(['DEBUG']),  // matches msg at t=100
      nodeNames: new Set(['/node_c']), // matches msg at t=500
    });
    expect(result).toHaveLength(2);
  });

  // -- AND mode --

  it('AND mode: matches only if all conditions are true', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'AND',
      severityLevels: new Set<SeverityLevel>(['WARN', 'ERROR']),
      nodeNames: new Set(['/node_b']),
    });
    expect(result).toHaveLength(2);
  });

  it('AND mode: no match when conditions conflict', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'AND',
      severityLevels: new Set<SeverityLevel>(['DEBUG']),  // only /node_a
      nodeNames: new Set(['/node_c']), // only severity FATAL
    });
    expect(result).toHaveLength(0);
  });

  // -- Combined filters --

  it('AND mode with severity + keyword', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'AND',
      severityLevels: new Set<SeverityLevel>(['WARN', 'ERROR']),
      useRegex: false,
      messageKeywords: ['battery'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('WARN');
  });

  it('time range combined with other filters', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'OR',
      severityLevels: new Set<SeverityLevel>(['FATAL']),
      startTime: 100,
      endTime: 300,
    });
    // time range excludes t=400,500; severity=16 is at t=500 so excluded by time
    expect(result).toHaveLength(0);
  });
});

// ==================== filterDiagnostics ====================

describe('filterDiagnostics', () => {
  it('returns all when no filters applied', () => {
    expect(filterDiagnostics(diagEntries, {})).toHaveLength(4);
  });

  it('returns empty for empty input', () => {
    expect(filterDiagnostics([], {})).toHaveLength(0);
  });

  // -- Level --

  it('filters by level', () => {
    const result = filterDiagnostics(diagEntries, { levels: new Set([0]) });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('/sensor/lidar');
  });

  it('filters by multiple levels', () => {
    const result = filterDiagnostics(diagEntries, { levels: new Set([1, 2]) });
    expect(result).toHaveLength(2);
  });

  it('empty levels set returns all', () => {
    expect(filterDiagnostics(diagEntries, { levels: new Set() })).toHaveLength(4);
  });

  // -- Name --

  it('filters by name', () => {
    const result = filterDiagnostics(diagEntries, { names: new Set(['/motor/left']) });
    expect(result).toHaveLength(1);
  });

  it('non-matching name returns empty', () => {
    const result = filterDiagnostics(diagEntries, { names: new Set(['/unknown']) });
    expect(result).toHaveLength(0);
  });

  // -- Keywords --

  it('filters by keyword', () => {
    const result = filterDiagnostics(diagEntries, {
      useRegex: false,
      messageKeywords: 'overheating',
    });
    expect(result).toHaveLength(1);
  });

  it('filters by comma-separated keywords', () => {
    const result = filterDiagnostics(diagEntries, {
      useRegex: false,
      messageKeywords: 'running,stale',
    });
    expect(result).toHaveLength(2);
  });

  it('empty keywords means no filter', () => {
    const result = filterDiagnostics(diagEntries, {
      useRegex: false,
      messageKeywords: ',  ,',
    });
    expect(result).toHaveLength(4);
  });

  // -- Regex --

  it('filters by regex', () => {
    const result = filterDiagnostics(diagEntries, {
      useRegex: true,
      messageRegex: 'warning.*fps',
    });
    expect(result).toHaveLength(1);
  });

  it('invalid regex is skipped', () => {
    const result = filterDiagnostics(diagEntries, {
      useRegex: true,
      messageRegex: '[bad(',
    });
    expect(result).toHaveLength(4);
  });

  // -- OR mode --

  it('OR mode: matches any condition', () => {
    const result = filterDiagnostics(diagEntries, {
      filterMode: 'OR',
      levels: new Set([0]),
      names: new Set(['/motor/right']),
    });
    expect(result).toHaveLength(2);
  });

  // -- AND mode --

  it('AND mode: matches all conditions', () => {
    const result = filterDiagnostics(diagEntries, {
      filterMode: 'AND',
      levels: new Set([2]),
      names: new Set(['/motor/left']),
    });
    expect(result).toHaveLength(1);
  });

  it('AND mode: no match when conditions conflict', () => {
    const result = filterDiagnostics(diagEntries, {
      filterMode: 'AND',
      levels: new Set([0]),
      names: new Set(['/motor/left']),
    });
    expect(result).toHaveLength(0);
  });
});

// ==================== SQLite export ====================

describe('SQLite export', () => {
  it('exports rosout messages to sqlite with expected schema and values', async () => {
    const binary = await exportToSQLite([
      {
        timestamp: 123.456789,
        node: '/node_sql',
        severity: 'ERROR',
        message: 'Error with, commas',
        file: '/tmp/test.cpp',
        line: 42,
        function: 'main',
        topics: ['/rosout', '/alerts'],
      },
    ], 'utc');

    const SQL = await sqlPromise;
    const db = new SQL.Database(binary);
    const schema = db.exec('PRAGMA table_info(rosout_logs)');
    const rows = db.exec(`
      SELECT timestamp, time_text, node, severity, message, file, line, function_name, topics_text
      FROM rosout_logs
    `);

    expect(schema[0].values.map(column => column[1])).toEqual([
      'id',
      'timestamp',
      'time_text',
      'node',
      'severity',
      'message',
      'file',
      'line',
      'function_name',
      'topics_text',
    ]);
    expect(rows[0].values).toEqual([
      [123.456789, '1970-01-01 00:02:03.456 UTC', '/node_sql', 'ERROR', 'Error with, commas', '/tmp/test.cpp', 42, 'main', '/rosout;/alerts'],
    ]);

    db.close();
  });

  it('exports diagnostics and diagnostic_values tables for sqlite', async () => {
    const binary = await exportDiagnosticsToSQLite([
      {
        timestamp: 200,
        name: '/sensor/camera',
        level: 1,
        message: 'Warning: low fps',
        values: [
          { key: 'fps', value: '12' },
          { key: 'temperature', value: '76' },
        ],
      },
      {
        timestamp: 201,
        name: '/sensor/lidar',
        level: 0,
        message: 'OK',
        values: [],
      },
    ], 'utc');

    const SQL = await sqlPromise;
    const db = new SQL.Database(binary);
    const diagnosticsRows = db.exec(`
      SELECT id, timestamp, time_text, name, level_code, level_name, message
      FROM diagnostics
      ORDER BY id
    `);
    const valueRows = db.exec(`
      SELECT diagnostic_id, key, value
      FROM diagnostic_values
      ORDER BY diagnostic_id, id
    `);

    expect(diagnosticsRows[0].values).toEqual([
      [1, 200, '1970-01-01 00:03:20.000 UTC', '/sensor/camera', 1, 'WARN', 'Warning: low fps'],
      [2, 201, '1970-01-01 00:03:21.000 UTC', '/sensor/lidar', 0, 'OK', 'OK'],
    ]);
    expect(valueRows[0].values).toEqual([
      [1, 'fps', '12'],
      [1, 'temperature', '76'],
    ]);

    db.close();
  });
});
