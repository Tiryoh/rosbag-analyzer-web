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
 * Remove string literals from SQL to avoid false positives in keyword detection.
 * Replaces single-quoted and double-quoted strings with empty strings.
 */
function removeStringLiterals(sql: string): string {
  // Remove single-quoted strings (handle escaped quotes '')
  let result = sql.replace(/'(?:[^']|'')*'/g, '');
  // Remove double-quoted identifiers/strings (handle escaped quotes "")
  result = result.replace(/"(?:[^"]|"")*"/g, '');
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

  // Remove comments (both -- and /* */ style)
  const withoutLineComments = trimmed.split('\n').map(line => {
    const commentIdx = line.indexOf('--');
    return commentIdx >= 0 ? line.substring(0, commentIdx) : line;
  }).join('\n');
  
  const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutStrings = removeStringLiterals(withoutComments);
  const normalized = withoutStrings.trim().toUpperCase();

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
    if (pattern.test(withoutStrings)) {
      throw new SqlValidationError(`Forbidden keyword: ${keyword}`);
    }
  }

  // Check for forbidden functions
  for (const func of FORBIDDEN_FUNCTIONS) {
    const pattern = new RegExp(`\\b${func}\\s*\\(`, 'i');
    if (pattern.test(withoutStrings)) {
      throw new SqlValidationError(`Forbidden function: ${func}`);
    }
  }

  // Must start with SELECT or WITH
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw new SqlValidationError('Only SELECT or WITH queries are allowed');
  }
}
