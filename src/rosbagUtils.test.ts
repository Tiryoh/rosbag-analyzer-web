import { describe, it, expect } from 'vitest';
import { filterMessages, filterDiagnostics } from './rosbagUtils';
import type { RosoutMessage, DiagnosticStatusEntry } from './types';

// -- Test fixtures --

const rosoutMessages: RosoutMessage[] = [
  { timestamp: 100, node: '/node_a', severity: 1, message: 'debug info here' },
  { timestamp: 200, node: '/node_a', severity: 2, message: 'all systems go' },
  { timestamp: 300, node: '/node_b', severity: 4, message: 'Warning: low battery' },
  { timestamp: 400, node: '/node_b', severity: 8, message: 'Error: connection lost' },
  { timestamp: 500, node: '/node_c', severity: 16, message: 'FATAL crash detected' },
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
    const result = filterMessages(rosoutMessages, { severityLevels: new Set([2]) });
    expect(result).toHaveLength(1);
    expect(result[0].node).toBe('/node_a');
    expect(result[0].severity).toBe(2);
  });

  it('filters by multiple severities', () => {
    const result = filterMessages(rosoutMessages, { severityLevels: new Set([4, 8]) });
    expect(result).toHaveLength(2);
    expect(result.every(m => [4, 8].includes(m.severity))).toBe(true);
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
    expect(result[0].severity).toBe(8);
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
      severityLevels: new Set([1]),  // matches msg at t=100
      nodeNames: new Set(['/node_c']), // matches msg at t=500
    });
    expect(result).toHaveLength(2);
  });

  // -- AND mode --

  it('AND mode: matches only if all conditions are true', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'AND',
      severityLevels: new Set([4, 8]),
      nodeNames: new Set(['/node_b']),
    });
    expect(result).toHaveLength(2);
  });

  it('AND mode: no match when conditions conflict', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'AND',
      severityLevels: new Set([1]),  // only /node_a
      nodeNames: new Set(['/node_c']), // only severity 16
    });
    expect(result).toHaveLength(0);
  });

  // -- Combined filters --

  it('AND mode with severity + keyword', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'AND',
      severityLevels: new Set([4, 8]),
      useRegex: false,
      messageKeywords: ['battery'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe(4);
  });

  it('time range combined with other filters', () => {
    const result = filterMessages(rosoutMessages, {
      filterMode: 'OR',
      severityLevels: new Set([16]),
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
