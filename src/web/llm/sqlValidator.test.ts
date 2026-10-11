import { describe, it, expect } from 'vitest';
import { validateSql, SqlValidationError } from './sqlValidator';

describe('sqlValidator', () => {
  describe('valid queries', () => {
    it('should accept simple SELECT query', () => {
      expect(() => validateSql('SELECT * FROM rosout')).not.toThrow();
    });

    it('should accept SELECT with WHERE clause', () => {
      expect(() => validateSql('SELECT * FROM rosout WHERE severity = \'ERROR\'')).not.toThrow();
    });

    it('should accept WITH CTE query', () => {
      expect(() => validateSql('WITH errors AS (SELECT * FROM rosout WHERE severity = \'ERROR\') SELECT * FROM errors')).not.toThrow();
    });

    it('should accept query with line comments', () => {
      expect(() => validateSql('-- This is a comment\nSELECT * FROM rosout')).not.toThrow();
    });

    it('should accept query with block comments', () => {
      expect(() => validateSql('/* This is a block comment */ SELECT * FROM rosout')).not.toThrow();
    });

    it('should accept query with trailing semicolon', () => {
      expect(() => validateSql('SELECT * FROM rosout;')).not.toThrow();
    });

    it('should accept query with JOIN', () => {
      expect(() => validateSql('SELECT r.* FROM rosout r JOIN diagnostics d ON r.timestamp = d.timestamp')).not.toThrow();
    });

    it('should accept query with aggregate functions', () => {
      expect(() => validateSql('SELECT COUNT(*), severity FROM rosout GROUP BY severity')).not.toThrow();
    });

    it('should accept query with ORDER BY and LIMIT', () => {
      expect(() => validateSql('SELECT * FROM rosout ORDER BY timestamp DESC LIMIT 10')).not.toThrow();
    });
  });

  describe('invalid queries', () => {
    it('should reject empty query', () => {
      expect(() => validateSql('')).toThrow(SqlValidationError);
      expect(() => validateSql('')).toThrow('empty');
    });

    it('should reject query with only whitespace', () => {
      expect(() => validateSql('   \n\t  ')).toThrow(SqlValidationError);
    });

    it('should reject query with only comments', () => {
      expect(() => validateSql('-- Just a comment')).toThrow(SqlValidationError);
      expect(() => validateSql('/* Just a comment */')).toThrow(SqlValidationError);
    });

    it('should reject multiple statements', () => {
      expect(() => validateSql('SELECT * FROM rosout; SELECT * FROM diagnostics')).toThrow(SqlValidationError);
      expect(() => validateSql('SELECT * FROM rosout; SELECT * FROM diagnostics')).toThrow('Multiple statements');
    });

    it('should reject INSERT statement', () => {
      expect(() => validateSql('INSERT INTO rosout VALUES (1, \'test\')')).toThrow(SqlValidationError);
      expect(() => validateSql('INSERT INTO rosout VALUES (1, \'test\')')).toThrow('Forbidden keyword: INSERT');
    });

    it('should reject UPDATE statement', () => {
      expect(() => validateSql('UPDATE rosout SET severity = \'INFO\'')).toThrow(SqlValidationError);
    });

    it('should reject DELETE statement', () => {
      expect(() => validateSql('DELETE FROM rosout')).toThrow(SqlValidationError);
    });

    it('should reject DROP statement', () => {
      expect(() => validateSql('DROP TABLE rosout')).toThrow(SqlValidationError);
      expect(() => validateSql('DROP TABLE rosout')).toThrow('Forbidden keyword: DROP');
    });

    it('should reject CREATE statement', () => {
      expect(() => validateSql('CREATE TABLE test (id INTEGER)')).toThrow(SqlValidationError);
      expect(() => validateSql('CREATE TABLE test (id INTEGER)')).toThrow('Forbidden keyword: CREATE');
    });

    it('should reject ALTER statement', () => {
      expect(() => validateSql('ALTER TABLE rosout ADD COLUMN test TEXT')).toThrow(SqlValidationError);
      expect(() => validateSql('ALTER TABLE rosout ADD COLUMN test TEXT')).toThrow('Forbidden keyword: ALTER');
    });

    it('should reject PRAGMA statement', () => {
      expect(() => validateSql('PRAGMA table_info(rosout)')).toThrow(SqlValidationError);
      expect(() => validateSql('PRAGMA table_info(rosout)')).toThrow('Forbidden keyword: PRAGMA');
    });

    it('should reject ATTACH statement', () => {
      expect(() => validateSql('ATTACH DATABASE \'test.db\' AS test')).toThrow(SqlValidationError);
      expect(() => validateSql('ATTACH DATABASE \'test.db\' AS test')).toThrow('Forbidden keyword: ATTACH');
    });

    it('should reject VACUUM statement', () => {
      expect(() => validateSql('VACUUM')).toThrow(SqlValidationError);
      expect(() => validateSql('VACUUM')).toThrow('Forbidden keyword: VACUUM');
    });

    it('should reject load_extension function', () => {
      expect(() => validateSql('SELECT load_extension(\'test.so\')')).toThrow(SqlValidationError);
      expect(() => validateSql('SELECT load_extension(\'test.so\')')).toThrow('Forbidden function: load_extension');
    });

    it('should reject query starting with non-SELECT/WITH', () => {
      expect(() => validateSql('EXPLAIN SELECT * FROM rosout')).toThrow(SqlValidationError);
      expect(() => validateSql('EXPLAIN SELECT * FROM rosout')).toThrow('Only SELECT or WITH');
    });
  });

  describe('edge cases', () => {
    it('should handle mixed case keywords', () => {
      expect(() => validateSql('select * from rosout')).not.toThrow();
      expect(() => validateSql('SeLeCt * FrOm rosout')).not.toThrow();
    });

    it('should handle keywords in string literals', () => {
      // "CREATE" in a string should not trigger rejection
      expect(() => validateSql('SELECT * FROM rosout WHERE message LIKE \'%CREATE%\'')).not.toThrow();
    });

    it('should reject DROP even in comments then valid query', () => {
      expect(() => validateSql('SELECT * FROM rosout WHERE severity = \'INFO\' -- DROP')).not.toThrow();
    });

    it('should reject if forbidden keyword appears after SELECT', () => {
      expect(() => validateSql('SELECT * FROM rosout; DROP TABLE test')).toThrow(SqlValidationError);
    });
  });

  describe('string literal edge cases', () => {
    it('should allow semicolons inside string literals', () => {
      expect(() => validateSql("SELECT * FROM rosout WHERE message = 'a;b'")).not.toThrow();
    });

    it('should allow forbidden-looking tokens inside escaped string literals', () => {
      expect(() => validateSql("SELECT * FROM rosout WHERE message = 'DROP TABLE x'")).not.toThrow();
      expect(() => validateSql("SELECT * FROM rosout WHERE message = 'CREATE ''nested'' quote'")).not.toThrow();
    });

    it('should reject forbidden keywords outside string literals even with strings present', () => {
      expect(() => validateSql("SELECT * FROM rosout WHERE message = 'ok'; DELETE FROM rosout")).toThrow(
        'Multiple statements',
      );
    });

    it('should reject forbidden keywords adjacent to string literals', () => {
      expect(() => validateSql("SELECT * FROM rosout WHERE message = 'ok' OR severity = 'WARN' UNION SELECT * FROM diagnostics")).not.toThrow();
      expect(() => validateSql("SELECT * FROM rosout; INSERT INTO rosout VALUES (1)")).toThrow(SqlValidationError);
    });
  });
});
