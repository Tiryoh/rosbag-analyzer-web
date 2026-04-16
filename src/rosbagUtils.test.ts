import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parquetReadObjects } from 'hyparquet';
import { ReindexFailureError } from './reindexUtils';
import {
  filterMessages, filterDiagnostics,
  exportToParquet, exportDiagnosticsToParquet,
  exportToCSV, exportToJSON, exportToTXT,
  exportDiagnosticsToCSV, exportDiagnosticsToJSON, exportDiagnosticsToTXT,
  escapeCSV,
  loadMessages,
} from './rosbagUtils';
import type { RosoutMessage, DiagnosticStatusEntry, SeverityLevel } from './types';

// -- Test fixtures --

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadFixtureFile(name: string): Promise<File> {
  const fixturePath = path.resolve(__dirname, '../e2e/fixtures', name);
  const buffer = await readFile(fixturePath);
  return new File([buffer], name);
}

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

// ==================== escapeCSV ====================

describe('escapeCSV', () => {
  it('returns plain string unchanged', () => {
    expect(escapeCSV('hello')).toBe('hello');
  });

  it('wraps value containing comma in quotes', () => {
    expect(escapeCSV('a,b')).toBe('"a,b"');
  });

  it('wraps and escapes double quotes', () => {
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps value containing newline', () => {
    expect(escapeCSV('line1\nline2')).toBe('"line1\nline2"');
  });

  it('wraps value containing carriage return', () => {
    // Per RFC 4180, CR must also trigger quoting (e.g. Windows CRLF in logs).
    expect(escapeCSV('line1\rline2')).toBe('"line1\rline2"');
    expect(escapeCSV('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('handles all special characters together', () => {
    expect(escapeCSV('a,"b\nc')).toBe('"a,""b\nc"');
  });
});

// ==================== exportToCSV ====================

describe('exportToCSV', () => {
  it('starts with UTF-8 BOM', () => {
    const result = exportToCSV(rosoutMessages, 'utc');
    expect(result.charCodeAt(0)).toBe(0xFEFF);
  });

  it('has correct header row', () => {
    const result = exportToCSV(rosoutMessages, 'utc');
    const lines = result.replace(/^\uFEFF/, '').split('\n');
    expect(lines[0]).toBe('Timestamp,Time,Node,Severity,Message,File,Line,Function,Topics');
  });

  it('has correct number of rows', () => {
    const result = exportToCSV(rosoutMessages, 'utc');
    const lines = result.replace(/^\uFEFF/, '').split('\n');
    expect(lines).toHaveLength(6); // 1 header + 5 data
  });

  it('first data row has expected values', () => {
    const result = exportToCSV(rosoutMessages, 'utc');
    const lines = result.replace(/^\uFEFF/, '').split('\n');
    const cols = lines[1].split(',');
    expect(cols[0]).toBe('100.000000');
    expect(cols[1]).toBe('1970-01-01 00:01:40.000 UTC');
    expect(cols[2]).toBe('/node_a');
    expect(cols[3]).toBe('DEBUG');
    expect(cols[4]).toBe('debug info here');
  });
});

// ==================== exportToJSON ====================

describe('exportToJSON', () => {
  it('produces valid JSON with correct count', () => {
    const result = exportToJSON(rosoutMessages, 'utc');
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(5);
  });

  it('first entry has expected field values', () => {
    const result = exportToJSON(rosoutMessages, 'utc');
    const parsed = JSON.parse(result);
    expect(parsed[0]).toMatchObject({
      timestamp: 100,
      time: '1970-01-01 00:01:40.000 UTC',
      node: '/node_a',
      severity: 'DEBUG',
      message: 'debug info here',
    });
  });

  it('optional fields default correctly', () => {
    const result = exportToJSON(rosoutMessages, 'utc');
    const parsed = JSON.parse(result);
    expect(parsed[0].file).toBe('');
    expect(parsed[0].line).toBe(0);
    expect(parsed[0].function).toBe('');
    expect(parsed[0].topics).toEqual([]);
  });
});

// ==================== exportToTXT ====================

describe('exportToTXT', () => {
  it('has correct number of lines', () => {
    const result = exportToTXT(rosoutMessages, 'utc');
    expect(result.split('\n')).toHaveLength(5);
  });

  it('first line has correct format', () => {
    const result = exportToTXT(rosoutMessages, 'utc');
    const firstLine = result.split('\n')[0];
    expect(firstLine).toBe('[1970-01-01 00:01:40.000 UTC] [DEBUG] [/node_a]: debug info here');
  });

  it('includes file location when present', () => {
    const msgWithFile: RosoutMessage = {
      timestamp: 100, node: '/node_a', severity: 'INFO', message: 'test',
      file: 'test_node.cpp', line: 42,
    };
    const result = exportToTXT([msgWithFile], 'utc');
    expect(result).toContain('(test_node.cpp:42)');
  });
});

// ==================== exportDiagnosticsToCSV ====================

describe('exportDiagnosticsToCSV', () => {
  it('starts with UTF-8 BOM', () => {
    const result = exportDiagnosticsToCSV(diagEntries, 'utc');
    expect(result.charCodeAt(0)).toBe(0xFEFF);
  });

  it('has correct header row', () => {
    const result = exportDiagnosticsToCSV(diagEntries, 'utc');
    const lines = result.replace(/^\uFEFF/, '').split('\n');
    expect(lines[0]).toBe('Timestamp,Time,Name,Level,Message,Values');
  });

  it('uses human-readable level names', () => {
    const result = exportDiagnosticsToCSV(diagEntries, 'utc');
    const lines = result.replace(/^\uFEFF/, '').split('\n');
    // Assert on the Level column (index 3) specifically, not the full
    // line — `toContain('OK')` would also match the message field
    // 'OK running', making the assertion meaningless for that row.
    expect(lines[1].split(',')[3]).toBe('OK');
    expect(lines[2].split(',')[3]).toBe('WARN');
    expect(lines[3].split(',')[3]).toBe('ERROR');
    expect(lines[4].split(',')[3]).toBe('STALE');
  });

  it('formats values column correctly', () => {
    const entryWithValues: DiagnosticStatusEntry = {
      timestamp: 500, name: '/sensor/imu', level: 0, message: 'OK',
      values: [{ key: 'rate', value: '100' }, { key: 'temp', value: '42' }],
    };
    const result = exportDiagnosticsToCSV([entryWithValues], 'utc');
    const lines = result.replace(/^\uFEFF/, '').split('\n');
    expect(lines[1]).toContain('rate=100; temp=42');
  });
});

// ==================== exportDiagnosticsToJSON ====================

describe('exportDiagnosticsToJSON', () => {
  it('produces valid JSON with correct count', () => {
    const result = exportDiagnosticsToJSON(diagEntries, 'utc');
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(4);
  });

  it('uses human-readable level names', () => {
    const result = exportDiagnosticsToJSON(diagEntries, 'utc');
    const parsed = JSON.parse(result);
    expect(parsed[0].level).toBe('OK');
    expect(parsed[1].level).toBe('WARN');
    expect(parsed[2].level).toBe('ERROR');
    expect(parsed[3].level).toBe('STALE');
  });

  it('preserves values array structure', () => {
    const entryWithValues: DiagnosticStatusEntry = {
      timestamp: 500, name: '/sensor/imu', level: 0, message: 'OK',
      values: [{ key: 'rate', value: '100' }, { key: 'temp', value: '42' }],
    };
    const result = exportDiagnosticsToJSON([entryWithValues], 'utc');
    const parsed = JSON.parse(result);
    expect(parsed[0].values).toEqual([
      { key: 'rate', value: '100' },
      { key: 'temp', value: '42' },
    ]);
  });
});

// ==================== exportDiagnosticsToTXT ====================

describe('exportDiagnosticsToTXT', () => {
  it('has correct number of lines', () => {
    const result = exportDiagnosticsToTXT(diagEntries, 'utc');
    expect(result.split('\n')).toHaveLength(4);
  });

  it('first line has correct format', () => {
    const result = exportDiagnosticsToTXT(diagEntries, 'utc');
    const firstLine = result.split('\n')[0];
    expect(firstLine).toBe('[1970-01-01 00:01:40.000 UTC] [OK] /sensor/lidar: OK running');
  });

  it('appends values when present', () => {
    const entryWithValues: DiagnosticStatusEntry = {
      timestamp: 500, name: '/sensor/imu', level: 0, message: 'OK',
      values: [{ key: 'rate', value: '100' }, { key: 'temp', value: '42' }],
    };
    const result = exportDiagnosticsToTXT([entryWithValues], 'utc');
    expect(result).toContain('{rate=100, temp=42}');
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

describe('loadMessages reindex metadata', () => {
  it('returns non-partial reindex metadata for a valid unindexed bag', async () => {
    const file = await loadFixtureFile('test_unindexed.bag');
    const result = await loadMessages(file);

    expect(result.reindexedBlob).toBeInstanceOf(Blob);
    expect(result.reindexMeta).toMatchObject({
      partial: false,
      chunksSeen: 1,
      chunksSkipped: 0,
    });
    expect(result.reindexMeta?.warnings).toHaveLength(0);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('returns partial reindex metadata when a readable bag has truncated tail bytes', async () => {
    const file = await loadFixtureFile('test_unindexed.bag');
    const originalBuffer = new Uint8Array(await file.arrayBuffer());
    const corruptedBuffer = new Uint8Array(originalBuffer.length + 3);
    corruptedBuffer.set(originalBuffer, 0);
    corruptedBuffer.set([0xde, 0xad, 0xbe], originalBuffer.length);
    const corruptedFile = new File([corruptedBuffer], 'test_unindexed_truncated_tail.bag');

    const result = await loadMessages(corruptedFile);

    expect(result.reindexedBlob).toBeInstanceOf(Blob);
    expect(result.reindexMeta?.partial).toBe(true);
    expect(result.reindexMeta?.chunksSeen).toBe(1);
    expect(result.reindexMeta?.warnings.some(warning => warning.code === 'truncated-tail')).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('surfaces recovery blockers when no chunk can be recovered', async () => {
    const file = await loadFixtureFile('test_truncated.bag');
    await expect(loadMessages(file)).rejects.toBeInstanceOf(ReindexFailureError);
  });

  it('surfaces recovery blocker details for unreadable truncated bags', async () => {
    const file = await loadFixtureFile('test_truncated.bag');
    try {
      await loadMessages(file);
      expect.fail('Expected loadMessages to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ReindexFailureError);
      expect((error as ReindexFailureError).blockers.some((warning) => warning.code === 'truncated-tail')).toBe(true);
    }
  });
});
