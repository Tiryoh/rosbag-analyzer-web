/**
 * SQL table layouts for the LLM SQL console.
 * Column names and order match `exportToParquet` / `exportDiagnosticsToParquet`
 * in `src/core/rosbagUtils.ts`.
 */
export const ROSOUT_TABLE_COLUMNS = [
  'timestamp',
  'time_text',
  'node',
  'severity',
  'message',
  'file',
  'line',
  'function_name',
  'topics_text',
] as const;

export const DIAGNOSTICS_TABLE_COLUMNS = [
  'timestamp',
  'time_text',
  'name',
  'level_code',
  'level_name',
  'message',
  'values_json',
] as const;

/** Parquet export column names (must stay in sync with rosbagUtils parquet writers). */
export const PARQUET_ROSOUT_COLUMNS = [...ROSOUT_TABLE_COLUMNS] as const;
export const PARQUET_DIAGNOSTICS_COLUMNS = [...DIAGNOSTICS_TABLE_COLUMNS] as const;
