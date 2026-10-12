/**
 * Validates and sanitizes SQL queries for read-only access.
 * Only allows single SELECT or WITH statements.
 */

const FORBIDDEN_KEYWORDS = [
  'ATTACH',
  'PRAGMA',
  'CREATE',
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'VACUUM',
  'REPLACE',
  'MERGE',
  'TRUNCATE',
  'DETACH',
  'REINDEX',
  'ANALYZE',
];

const FORBIDDEN_FUNCTIONS = [
  'load_extension',
  'load_extension_file',
];

export class SqlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlValidationError';
  }
}

/**
 * Blank out comments and string literal contents so that only SQL code remains.
 * The result has the same length as the input, so indices map back to `sql`.
 * Comments become spaces (newlines are kept), and string literals keep their
 * quotes with their contents replaced by spaces. Scanning is done in a single
 * pass, so comment markers inside strings and quotes inside comments are not
 * mistaken for each other.
 */
function maskNonCode(sql: string): string {
  let result = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    let end: number;
    if (ch === '-' && sql[i + 1] === '-') {
      const newline = sql.indexOf('\n', i + 2);
      end = newline < 0 ? sql.length : newline;
      result += ' '.repeat(end - i);
    } else if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      end = close < 0 ? sql.length : close + 2;
      result += sql.slice(i, end).replace(/[^\n]/g, ' ');
    } else if (ch === "'" || ch === '"') {
      // Doubled quotes are escapes, so scanning to each closing quote handles them.
      // An unterminated literal runs to the end of the input.
      const close = sql.indexOf(ch, i + 1);
      end = close < 0 ? sql.length : close + 1;
      result += close < 0 ? ch + ' '.repeat(end - i - 1) : ch + ' '.repeat(end - i - 2) + ch;
    } else {
      end = i + 1;
      result += ch;
    }
    i = end;
  }
  return result;
}

/**
 * Validates a SQL query string.
 * Throws SqlValidationError if the query is not safe.
 */
export function validateSql(sql: string): void {
  const trimmed = sql.trim();
  
  if (!trimmed) {
    throw new SqlValidationError('Query is empty');
  }

  const code = maskNonCode(trimmed);
  const normalized = code.trim().toUpperCase();

  if (!normalized) {
    throw new SqlValidationError('Query contains only comments');
  }

  // Check for multiple statements (semicolon not at the end)
  const semicolonIndex = normalized.lastIndexOf(';');
  if (semicolonIndex >= 0 && semicolonIndex < normalized.length - 1) {
    throw new SqlValidationError('Multiple statements are not allowed');
  }

  // Check for forbidden keywords first (before SELECT/WITH check)
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Use word boundaries to avoid false positives
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    if (pattern.test(code)) {
      throw new SqlValidationError(`Forbidden keyword: ${keyword}`);
    }
  }

  // Check for forbidden functions
  for (const func of FORBIDDEN_FUNCTIONS) {
    const pattern = new RegExp(`\\b${func}\\s*\\(`, 'i');
    if (pattern.test(code)) {
      throw new SqlValidationError(`Forbidden function: ${func}`);
    }
  }

  // Must start with SELECT or WITH
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw new SqlValidationError('Only SELECT or WITH queries are allowed');
  }
}

/**
 * Wrap a validated query so that at most `limit` rows are returned.
 * A trailing semicolon is removed, and the query is placed on its own lines
 * so that a trailing line comment cannot swallow the closing parenthesis.
 */
export function wrapWithLimit(sql: string, limit: number): string {
  const last = maskNonCode(sql).trimEnd().length - 1;
  const body = last >= 0 && sql[last] === ';' ? sql.slice(0, last) + sql.slice(last + 1) : sql;
  return `SELECT * FROM (\n${body.trim()}\n) LIMIT ${limit}`;
}
