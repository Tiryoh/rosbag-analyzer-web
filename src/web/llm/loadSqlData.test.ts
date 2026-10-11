import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataIntoDb } from './loadSqlData';
import {
  DIAGNOSTICS_TABLE_COLUMNS,
  PARQUET_DIAGNOSTICS_COLUMNS,
  PARQUET_ROSOUT_COLUMNS,
  ROSOUT_TABLE_COLUMNS,
} from './sqlSchema';
import { getTestSqlModule } from './sqlTestUtils';
import type { RosoutMessage, DiagnosticStatusEntry } from '../../core/types';
import type { SqlJsModule } from './sqlEngine';

function tableColumnNames(db: InstanceType<SqlJsModule['Database']>, table: string): string[] {
  const result = db.exec(`PRAGMA table_info(${table})`);
  return result[0].values.map((row) => String(row[1]));
}

describe('loadSqlData', () => {
  let SQL: SqlJsModule;

  beforeAll(async () => {
    SQL = await getTestSqlModule();
  });

  it('defines rosout/diagnostics columns in Parquet export order', () => {
    expect([...PARQUET_ROSOUT_COLUMNS]).toEqual([
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
    expect([...PARQUET_DIAGNOSTICS_COLUMNS]).toEqual([
      'timestamp',
      'time_text',
      'name',
      'level_code',
      'level_name',
      'message',
      'values_json',
    ]);
    expect(PARQUET_ROSOUT_COLUMNS).toEqual(ROSOUT_TABLE_COLUMNS);
    expect(PARQUET_DIAGNOSTICS_COLUMNS).toEqual(DIAGNOSTICS_TABLE_COLUMNS);
  });

  it('should create rosout and diagnostics tables', () => {
    const db = new SQL.Database();
    loadDataIntoDb(db, [], []);

    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    expect(tables[0].values.flat()).toEqual(['diagnostics', 'rosout']);

    expect(tableColumnNames(db, 'rosout')).toEqual([...ROSOUT_TABLE_COLUMNS]);
    expect(tableColumnNames(db, 'diagnostics')).toEqual([...DIAGNOSTICS_TABLE_COLUMNS]);

    db.close();
  });

  it('should load rosout messages with Parquet-aligned columns', () => {
    const db = new SQL.Database();
    const messages: RosoutMessage[] = [
      {
        timestamp: 1234567890.123,
        node: '/test_node',
        severity: 'ERROR',
        message: 'Test error message',
        file: 'test.cpp',
        line: 42,
        function: 'testFunction',
        topics: ['/rosout'],
      },
      {
        timestamp: 1234567891.456,
        node: '/another_node',
        severity: 'INFO',
        message: 'Test info message',
        topics: ['/rosout', '/rosout_agg'],
      },
    ];

    loadDataIntoDb(db, messages, []);

    const result = db.exec('SELECT COUNT(*) FROM rosout');
    expect(result[0].values[0][0]).toBe(2);

    const data = db.exec('SELECT * FROM rosout ORDER BY timestamp');
    expect(data[0].columns).toEqual([...ROSOUT_TABLE_COLUMNS]);
    expect(data[0].values[0][2]).toBe('/test_node');
    expect(data[0].values[0][3]).toBe('ERROR');
    expect(data[0].values[0][8]).toBe('/rosout');

    db.close();
  });

  it('should load diagnostics entries with Parquet-aligned columns', () => {
    const db = new SQL.Database();
    const diagnostics: DiagnosticStatusEntry[] = [
      {
        timestamp: 1234567890.123,
        name: 'test_hardware',
        level: 2,
        message: 'Hardware error',
        values: [
          { key: 'temperature', value: '85.5' },
          { key: 'status', value: 'overheating' },
        ],
      },
    ];

    loadDataIntoDb(db, [], diagnostics);

    const data = db.exec('SELECT * FROM diagnostics ORDER BY timestamp');
    expect(data[0].columns).toEqual([...DIAGNOSTICS_TABLE_COLUMNS]);
    expect(data[0].values[0][2]).toBe('test_hardware');
    expect(data[0].values[0][4]).toBe('ERROR');
    expect(JSON.parse(data[0].values[0][6] as string)).toEqual([
      { key: 'temperature', value: '85.5' },
      { key: 'status', value: 'overheating' },
    ]);

    db.close();
  });

  it('should handle empty message arrays', () => {
    const db = new SQL.Database();
    loadDataIntoDb(db, [], []);

    expect(db.exec('SELECT COUNT(*) FROM rosout')[0].values[0][0]).toBe(0);
    expect(db.exec('SELECT COUNT(*) FROM diagnostics')[0].values[0][0]).toBe(0);

    db.close();
  });

  it('should handle messages with missing optional fields', () => {
    const db = new SQL.Database();
    const messages: RosoutMessage[] = [
      {
        timestamp: 1234567890.123,
        node: '/test_node',
        severity: 'WARN',
        message: 'Warning without details',
      },
    ];

    loadDataIntoDb(db, messages, []);

    const data = db.exec('SELECT file, line, function_name, topics_text FROM rosout');
    expect(data[0].values[0]).toEqual(['', 0, '', '']);

    db.close();
  });

  it('should allow read-only SELECT queries after load', () => {
    const db = new SQL.Database();
    const messages: RosoutMessage[] = [
      { timestamp: 1, node: '/node1', severity: 'ERROR', message: 'error1' },
      { timestamp: 2, node: '/node1', severity: 'WARN', message: 'warn1' },
      { timestamp: 3, node: '/node2', severity: 'ERROR', message: 'error2' },
    ];

    loadDataIntoDb(db, messages, []);

    const errors = db.exec("SELECT COUNT(*) FROM rosout WHERE severity = 'ERROR'");
    expect(errors[0].values[0][0]).toBe(2);

    const grouped = db.exec('SELECT severity, COUNT(*) FROM rosout GROUP BY severity ORDER BY severity');
    expect(grouped[0].values).toEqual([
      ['ERROR', 2],
      ['WARN', 1],
    ]);

    db.close();
  });
});
