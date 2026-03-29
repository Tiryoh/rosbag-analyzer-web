import { describe, it, expect } from 'vitest';
import { parquetReadObjects } from 'hyparquet';
import { filterMessages, filterDiagnostics, exportToParquet, exportDiagnosticsToParquet, loadMessages } from './rosbagUtils';
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

// ==================== Parquet export ====================

describe('Parquet export', () => {
  it('exports rosout messages to parquet with expected columns and values', async () => {
    const binary = exportToParquet([
      {
        timestamp: 123.456789,
        node: '/node_pq',
        severity: 'ERROR',
        message: 'Error with, commas',
        file: '/tmp/test.cpp',
        line: 42,
        function: 'main',
        topics: ['/rosout', '/alerts'],
      },
    ], 'utc');

    const rows = await parquetReadObjects({ file: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer }) as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      timestamp: 123.456789,
      time_text: '1970-01-01 00:02:03.456 UTC',
      node: '/node_pq',
      severity: 'ERROR',
      message: 'Error with, commas',
      file: '/tmp/test.cpp',
      line: 42,
      function_name: 'main',
      topics_text: '/rosout;/alerts',
    });
  });

  it('exports diagnostics to parquet with values_json column', async () => {
    const binary = exportDiagnosticsToParquet([
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

    const rows = await parquetReadObjects({ file: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer }) as Record<string, unknown>[];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      timestamp: 200,
      time_text: '1970-01-01 00:03:20.000 UTC',
      name: '/sensor/camera',
      level_code: 1,
      level_name: 'WARN',
      message: 'Warning: low fps',
    });
    expect(rows[0].values_json).toEqual([
      { key: 'fps', value: '12' },
      { key: 'temperature', value: '76' },
    ]);
    expect(rows[1]).toMatchObject({
      timestamp: 201,
      name: '/sensor/lidar',
      level_code: 0,
      level_name: 'OK',
      message: 'OK',
    });
    expect(rows[1].values_json).toEqual([]);
  });
});

// ==================== loadMessages error handling ====================

describe('loadMessages error handling', () => {
  it('rejects empty (0-byte) file', async () => {
    const emptyFile = new File([], 'empty.bag');
    await expect(loadMessages(emptyFile)).rejects.toThrow('Empty file');
  });

  it('rejects empty mcap file', async () => {
    const emptyFile = new File([], 'empty.mcap');
    await expect(loadMessages(emptyFile)).rejects.toThrow('Empty file');
  });

  it('shows file size in error when large file fails to read', async () => {
    const largeFile = {
      name: 'large.mcap',
      size: 1024 * 1024 * 1024, // 1 GB
      arrayBuffer: () => {
        const err = new DOMException('The requested file could not be read', 'NotReadableError');
        return Promise.reject(err);
      },
      slice: () => new Blob(),
    } as unknown as File;
    await expect(loadMessages(largeFile)).rejects.toThrow(/1024 MB.*too large/);
  });

  it('does not alter error for small files that fail to read', async () => {
    const smallFile = {
      name: 'small.bag',
      size: 1024, // 1 KB
      arrayBuffer: () => {
        const err = new DOMException('The requested file could not be read', 'NotReadableError');
        return Promise.reject(err);
      },
      slice: () => new Blob(),
    } as unknown as File;
    await expect(loadMessages(smallFile)).rejects.toThrow('The requested file could not be read');
  });
});
