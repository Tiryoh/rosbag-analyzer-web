import { useState, useEffect, useRef } from 'react';
import type { RosoutMessage, DiagnosticStatusEntry } from '../../core/types';
import { loadDataIntoDb } from './loadSqlData';
import { validateSql, SqlValidationError } from './sqlValidator';
import { initSqlEngine, SQL_THIRD_PARTY_LICENSES_URL } from './sqlEngine';
import type { SqlJsModule } from './sqlEngine';
import { getSqlText, type SqlTranslationKey } from './i18n';
import type { Lang } from '../i18n';
import { Play } from 'lucide-react';

type Database = InstanceType<SqlJsModule['Database']>;

interface SqlConsoleProps {
  messages: RosoutMessage[];
  diagnostics: DiagnosticStatusEntry[];
  timezone: 'local' | 'utc';
  lang: Lang;
}

const RESULT_LIMIT = 1000;

const SCHEMA_INFO = `-- rosout table schema
CREATE TABLE rosout (
  timestamp REAL,      -- Epoch seconds
  time_text TEXT,      -- Formatted timestamp
  node TEXT,           -- ROS node name
  severity TEXT,       -- DEBUG | INFO | WARN | ERROR | FATAL | UNKNOWN
  message TEXT,        -- Log message
  file TEXT,           -- Source file (may be empty)
  line INTEGER,        -- Source line (0 if not available)
  function_name TEXT,  -- Function name (may be empty)
  topics_text TEXT     -- Semicolon-separated topic list
);

-- diagnostics table schema
CREATE TABLE diagnostics (
  timestamp REAL,      -- Epoch seconds
  time_text TEXT,      -- Formatted timestamp
  name TEXT,           -- Diagnostic status name
  level_code INTEGER,  -- 0=OK, 1=WARN, 2=ERROR, 3=STALE
  level_name TEXT,     -- Level name (OK/WARN/ERROR/STALE)
  message TEXT,        -- Status message
  values_json TEXT     -- JSON array of key-value pairs
);`;

export function SqlConsole({ messages, diagnostics, timezone, lang }: SqlConsoleProps) {
  const t = (key: SqlTranslationKey) => getSqlText(lang, key);
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [sql, setSql] = useState('SELECT * FROM rosout LIMIT 10');
  const [results, setResults] = useState<{ columns: string[]; values: unknown[][] } | null>(null);
  const [queryError, setQueryError] = useState<string>('');
  const [executing, setExecuting] = useState(false);
  const [rowCount, setRowCount] = useState<number>(0);
  const dbRef = useRef<Database | null>(null);

  // Initialize SQL.js and load data
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        setLoading(true);
        setError('');

        const SQL = await initSqlEngine();

        if (!mounted) return;

        // Create in-memory database
        const database = new SQL.Database();
        loadDataIntoDb(database, messages, diagnostics, timezone);

        dbRef.current = database;
        setDb(database);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to initialize SQL engine');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      mounted = false;
      if (dbRef.current) {
        dbRef.current.close();
        dbRef.current = null;
      }
    };
  }, [messages, diagnostics, timezone]);

  const executeQuery = () => {
    if (!db) return;

    setExecuting(true);
    setQueryError('');
    setResults(null);
    setRowCount(0);

    try {
      // Validate query
      validateSql(sql);

      // Execute query with result limit
      const limitedSql = sql.trim().endsWith(';') ? sql.trim().slice(0, -1) : sql.trim();
      const wrappedSql = `SELECT * FROM (${limitedSql}) LIMIT ${RESULT_LIMIT}`;
      
      const stmt = db.prepare(wrappedSql);
      const columns = stmt.getColumnNames();
      const values: unknown[][] = [];

      while (stmt.step()) {
        values.push(stmt.get());
      }

      stmt.free();

      setResults({ columns, values });
      setRowCount(values.length);
    } catch (err) {
      if (err instanceof SqlValidationError) {
        setQueryError(`Validation error: ${err.message}`);
      } else if (err instanceof Error) {
        setQueryError(`SQL error: ${err.message}`);
      } else {
        setQueryError('Unknown error occurred');
      }
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <div className="border border-gray-300 rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-2">{t('title')}</h2>
        <div className="text-gray-600">{t('loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-300 rounded-lg p-4 bg-red-50">
        <h2 className="text-lg font-semibold mb-2 text-red-700">{t('title')}</h2>
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="border border-gray-300 rounded-lg p-4 bg-white space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">{t('title')}</h2>
        <p className="text-sm text-gray-600 mb-2">{t('description')}</p>
        <p className="text-xs text-gray-500">
          <a
            href={SQL_THIRD_PARTY_LICENSES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700"
          >
            {t('licenses')}
          </a>
        </p>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-gray-700 mb-2">
          {t('showSchema')}
        </summary>
        <pre className="bg-gray-50 p-3 rounded border border-gray-200 overflow-x-auto text-xs font-mono">
          {SCHEMA_INFO}
        </pre>
      </details>

      <div>
        <label htmlFor="sql-input" className="block text-sm font-medium text-gray-700 mb-1">
          {t('queryLabel')}
        </label>
        <textarea
          id="sql-input"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          className="w-full h-32 p-2 border border-gray-300 rounded font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder={t('queryPlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              executeQuery();
            }
          }}
        />
        <div className="mt-1 text-xs text-gray-500">
          {t('queryHint')}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={executeQuery}
          disabled={executing || !sql.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          <Play size={16} />
          {executing ? t('executing') : t('execute')}
        </button>
        {rowCount > 0 && (
          <span className="text-sm text-gray-600">
            {t('rowCount')}: {rowCount} {rowCount >= RESULT_LIMIT && `(${t('limited')})`}
          </span>
        )}
      </div>

      {queryError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {queryError}
        </div>
      )}

      {results && results.values.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {results.columns.map((col, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {results.values.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-gray-50">
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className="px-3 py-2 whitespace-nowrap text-gray-900 max-w-md truncate">
                      {cell === null ? (
                        <span className="text-gray-400 italic">NULL</span>
                      ) : typeof cell === 'string' && cell.length > 100 ? (
                        <span title={cell}>{cell.substring(0, 100)}...</span>
                      ) : (
                        String(cell)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results && results.values.length === 0 && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600 text-center">
          {t('noResults')}
        </div>
      )}
    </div>
  );
}
