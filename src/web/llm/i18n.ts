import type { Lang } from '../i18n';

export type SqlTranslationKey =
  | 'title'
  | 'description'
  | 'open'
  | 'loading'
  | 'showSchema'
  | 'queryLabel'
  | 'queryPlaceholder'
  | 'queryHint'
  | 'execute'
  | 'executing'
  | 'rowCount'
  | 'limited'
  | 'noResults'
  | 'licenses';

const translations: Record<Lang, Record<SqlTranslationKey, string>> = {
  en: {
    title: 'SQL Console',
    description: 'Query loaded rosout and diagnostics data using SQL. Read-only, limited to 1000 rows.',
    open: 'Open SQL Console',
    loading: 'Initializing SQL engine...',
    showSchema: 'Show table schema',
    queryLabel: 'SQL Query',
    queryPlaceholder: 'SELECT * FROM rosout WHERE severity = \'ERROR\' LIMIT 10',
    queryHint: 'Only SELECT and WITH queries allowed. Press Ctrl+Enter or Cmd+Enter to execute.',
    execute: 'Run Query',
    executing: 'Executing...',
    rowCount: 'Rows',
    limited: 'limited',
    noResults: 'Query returned no results',
    licenses: 'Third-party licenses (sql.js / SQLite wasm)',
  },
  ja: {
    title: 'SQLコンソール',
    description: '読み込まれた rosout と diagnostics データを SQL でクエリできます。読み取り専用、最大1000行まで。',
    open: 'SQLコンソールを開く',
    loading: 'SQLエンジンを初期化中...',
    showSchema: 'テーブルスキーマを表示',
    queryLabel: 'SQLクエリ',
    queryPlaceholder: 'SELECT * FROM rosout WHERE severity = \'ERROR\' LIMIT 10',
    queryHint: 'SELECT と WITH クエリのみ使用可能。Ctrl+Enter または Cmd+Enter で実行。',
    execute: 'クエリを実行',
    executing: '実行中...',
    rowCount: '行数',
    limited: '制限あり',
    noResults: 'クエリ結果が見つかりませんでした',
    licenses: 'サードパーティライセンス（sql.js / SQLite wasm）',
  },
};

export function getSqlText(lang: Lang, key: SqlTranslationKey): string {
  return translations[lang][key];
}
