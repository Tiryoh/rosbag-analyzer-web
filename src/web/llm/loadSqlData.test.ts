import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { loadDataIntoDb } from './loadSqlData';
import type { RosoutMessage, DiagnosticStatusEntry } from '../../core/types';

// Skip these tests in Node.js environment (sql.js wasm loading requires browser or special setup)
describe.skip('loadSqlData', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeAll(async () => {
    SQL = await initSqlJs({
      locateFile: (file) => `https://sql.js.org/dist/${file}`,
    });
  });

  it('should create rosout and diagnostics tables', () => {
    const db = new SQL.Database();
    loadDataIntoDb(db, [], []);

    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables[0].values.flat()).toContain('rosout');
    expect(tables[0].values.flat()).toContain('diagnostics');

    db.close();
  });

  it('should load rosout messages', () => {
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
    expect(data[0].values.length).toBe(2);
    expect(data[0].values[0][2]).toBe('/test_node'); // node
    expect(data[0].values[0][3]).toBe('ERROR'); // severity
    expect(data[0].values[0][4]).toBe('Test error message'); // message
    expect(data[0].values[0][5]).toBe('test.cpp'); // file
    expect(data[0].values[0][6]).toBe(42); // line
    expect(data[0].values[0][7]).toBe('testFunction'); // function_name
    expect(data[0].values[0][8]).toBe('/rosout'); // topics_text

    db.close();
  });

  it('should load diagnostics entries', () => {
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
      {
        timestamp: 1234567891.456,
        name: 'test_software',
        level: 0,
        message: 'All OK',
        values: [],
      },
    ];

    loadDataIntoDb(db, [], diagnostics);

    const result = db.exec('SELECT COUNT(*) FROM diagnostics');
    expect(result[0].values[0][0]).toBe(2);

    const data = db.exec('SELECT * FROM diagnostics ORDER BY timestamp');
    expect(data[0].values.length).toBe(2);
    expect(data[0].values[0][2]).toBe('test_hardware'); // name
    expect(data[0].values[0][3]).toBe(2); // level_code
    expect(data[0].values[0][4]).toBe('ERROR'); // level_name
    expect(data[0].values[0][5]).toBe('Hardware error'); // message
    
    const valuesJson = JSON.parse(data[0].values[0][6] as string);
    expect(valuesJson).toEqual([
      { key: 'temperature', value: '85.5' },
      { key: 'status', value: 'overheating' },
    ]);

    db.close();
  });

  it('should handle empty message arrays', () => {
    const db = new SQL.Database();
    loadDataIntoDb(db, [], []);

    const rosoutCount = db.exec('SELECT COUNT(*) FROM rosout');
    expect(rosoutCount[0].values[0][0]).toBe(0);

    const diagCount = db.exec('SELECT COUNT(*) FROM diagnostics');
    expect(diagCount[0].values[0][0]).toBe(0);

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
        // file, line, function, topics are undefined
      },
    ];

    loadDataIntoDb(db, messages, []);

    const data = db.exec('SELECT file, line, function_name, topics_text FROM rosout');
    expect(data[0].values[0][0]).toBe(''); // file
    expect(data[0].values[0][1]).toBe(0); // line
    expect(data[0].values[0][2]).toBe(''); // function_name
    expect(data[0].values[0][3]).toBe(''); // topics_text

    db.close();
  });

  it('should join topics with semicolons', () => {
    const db = new SQL.Database();
    const messages: RosoutMessage[] = [
      {
        timestamp: 1234567890.123,
        node: '/test',
        severity: 'INFO',
        message: 'test',
        topics: ['/rosout', '/rosout_agg', '/custom_topic'],
      },
    ];

    loadDataIntoDb(db, messages, []);

    const data = db.exec('SELECT topics_text FROM rosout');
    expect(data[0].values[0][0]).toBe('/rosout;/rosout_agg;/custom_topic');

    db.close();
  });

  it('should format timestamps according to timezone', () => {
    const db = new SQL.Database();
    const messages: RosoutMessage[] = [
      {
        timestamp: 1234567890.5,
        node: '/test',
        severity: 'INFO',
        message: 'test',
      },
    ];

    loadDataIntoDb(db, messages, [], 'utc');

    const data = db.exec('SELECT time_text FROM rosout');
    expect(data[0].values[0][0]).toContain('2009'); // Unix timestamp 1234567890 is in 2009

    db.close();
  });

  it('should allow querying data with SQL', () => {
    const db = new SQL.Database();
    const messages: RosoutMessage[] = [
      { timestamp: 1, node: '/node1', severity: 'ERROR', message: 'error1' },
      { timestamp: 2, node: '/node1', severity: 'WARN', message: 'warn1' },
      { timestamp: 3, node: '/node2', severity: 'ERROR', message: 'error2' },
    ];

    loadDataIntoDb(db, messages, []);

    // Query for errors only
    const errors = db.exec("SELECT COUNT(*) FROM rosout WHERE severity = 'ERROR'");
    expect(errors[0].values[0][0]).toBe(2);

    // Query by node
    const node1 = db.exec("SELECT COUNT(*) FROM rosout WHERE node = '/node1'");
    expect(node1[0].values[0][0]).toBe(2);

    // Group by severity
    const grouped = db.exec('SELECT severity, COUNT(*) FROM rosout GROUP BY severity ORDER BY severity');
    expect(grouped[0].values).toEqual([
      ['ERROR', 2],
      ['WARN', 1],
    ]);

    db.close();
  });
});
