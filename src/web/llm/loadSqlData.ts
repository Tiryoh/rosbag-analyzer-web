import type initSqlJs from 'sql.js';
import type { RosoutMessage, DiagnosticStatusEntry } from '../../core/types';
import { DIAGNOSTIC_LEVEL_NAMES } from '../../core/types';
import { formatTimestamp, type Timezone } from '../../core/rosbagUtils';
import { DIAGNOSTICS_TABLE_COLUMNS, ROSOUT_TABLE_COLUMNS } from './sqlSchema';

type Database = InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;

function columnDefs(columns: readonly string[], types: Record<string, string>): string {
  return columns.map((name) => `${name} ${types[name]}`).join(',\n      ');
}

const ROSOUT_COLUMN_TYPES: Record<string, string> = {
  timestamp: 'REAL',
  time_text: 'TEXT',
  node: 'TEXT',
  severity: 'TEXT',
  message: 'TEXT',
  file: 'TEXT',
  line: 'INTEGER',
  function_name: 'TEXT',
  topics_text: 'TEXT',
};

const DIAGNOSTICS_COLUMN_TYPES: Record<string, string> = {
  timestamp: 'REAL',
  time_text: 'TEXT',
  name: 'TEXT',
  level_code: 'INTEGER',
  level_name: 'TEXT',
  message: 'TEXT',
  values_json: 'TEXT',
};

/**
 * Loads rosout and diagnostics data into a SQLite in-memory database.
 * Creates tables matching the Parquet export schema.
 */
export function loadDataIntoDb(
  db: Database,
  messages: RosoutMessage[],
  diagnostics: DiagnosticStatusEntry[],
  timezone: Timezone = 'local'
): void {
  db.run(`
    CREATE TABLE rosout (
      ${columnDefs(ROSOUT_TABLE_COLUMNS, ROSOUT_COLUMN_TYPES)}
    )
  `);

  db.run(`
    CREATE TABLE diagnostics (
      ${columnDefs(DIAGNOSTICS_TABLE_COLUMNS, DIAGNOSTICS_COLUMN_TYPES)}
    )
  `);

  // Insert rosout messages
  if (messages.length > 0) {
    const insertRosout = db.prepare(`
      INSERT INTO rosout (timestamp, time_text, node, severity, message, file, line, function_name, topics_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const msg of messages) {
      insertRosout.run([
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
    }

    insertRosout.free();
  }

  // Insert diagnostics
  if (diagnostics.length > 0) {
    const insertDiag = db.prepare(`
      INSERT INTO diagnostics (timestamp, time_text, name, level_code, level_name, message, values_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const diag of diagnostics) {
      insertDiag.run([
        diag.timestamp,
        formatTimestamp(diag.timestamp, timezone),
        diag.name,
        diag.level,
        DIAGNOSTIC_LEVEL_NAMES[diag.level] || String(diag.level),
        diag.message,
        JSON.stringify(diag.values),
      ]);
    }

    insertDiag.free();
  }
}
