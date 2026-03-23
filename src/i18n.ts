import { useState, useEffect, useCallback } from 'react';

export type Lang = 'en' | 'ja';

const dictionaries: Record<Lang, Record<string, string>> = {
  en: {
    // Header
    'header.description': 'Browser-based tool for analyzing rosout/rosout_agg and diagnostics/diagnostics_agg',
    'header.privacy': 'All processing is done locally in your browser, no data is sent externally.',

    // File upload
    'upload.click': 'Click to upload',
    'upload.dragDrop': 'or drag and drop',
    'upload.fileType': 'ROSbag file (.bag)',

    // Loading / Error
    'loading.message': 'Loading bag file...',
    'error.title': 'Error loading bag file',
    'status.loadedRosout': 'Loaded {messageCount} rosout messages from {nodeCount} nodes',
    'status.loadedRosoutDiagnostics': 'Loaded {messageCount} rosout messages from {nodeCount} nodes, {diagnosticCount} diagnostics state changes',

    // Tabs
    'tab.rosout': 'Rosout',
    'tab.diagnostics': 'Diagnostics',

    // Filters
    'filter.title': 'Filters',
    'filter.mode': 'Filter Mode',
    'filter.mode.or': 'OR (Any match)',
    'filter.mode.and': 'AND (All match)',
    'filter.severity': 'Severity Levels',
    'filter.nodes': 'Nodes',
    'filter.selectAll': 'select all',
    'filter.clear': 'clear',
    'filter.messageType': 'Message Filter Type',
    'filter.keywords': 'Keywords',
    'filter.regex': 'Regex',
    'filter.keywordsLabel': 'Keywords (comma-separated)',
    'filter.regexLabel': 'Regular Expression Pattern',
    'filter.keywordsPlaceholder': 'e.g., error, timeout, connection',
    'filter.regexPlaceholder': 'e.g., error.*timeout|connection.*failed',
    'filter.apply': 'Apply Filters',
    'filter.clearAll': 'Clear Filters',
    'filter.levels': 'Levels',
    'filter.names': 'Names',

    // Statistics
    'stats.title': 'Statistics',
    'stats.show': 'Show Stats',
    'stats.hide': 'Hide Stats',
    'stats.bySeverity': 'By Severity',
    'stats.topNodes': 'Top 5 Nodes',

    // Export
    'export.title': 'Export',
    'export.messages': 'messages',
    'export.stateChanges': 'state changes',

    // Table
    'table.messages': 'Messages',
    'table.diagnosticsTitle': 'Diagnostics State Changes',
    'table.show': 'Show:',
    'table.time': 'Time',
    'table.node': 'Node',
    'table.level': 'Level',
    'table.message': 'Message',
    'table.name': 'Name',
    'table.details': 'Details',
    'table.valuesCount': '{count} values',
    'table.timezone.local': 'Local',
    'table.timezone.utc': 'UTC',
    'table.preview.messages': 'Showing first {shownCount} of {totalCount} messages',
    'table.preview.stateChanges': 'Showing first {shownCount} of {totalCount} state changes',
    'table.expandDetails': 'Expand details for {name}',
    'table.collapseDetails': 'Collapse details for {name}',

    // Empty state
    'empty.rosout': 'No messages match the current filters.',
    'empty.diagnostics': 'No diagnostics match the current filters.',

    // Footer
    'footer.offline': 'Works offline — all processing runs locally in your browser.',
    'footer.source': 'View source on GitHub',
  },
  ja: {
    // Header
    'header.description': 'rosout/rosout_agg・diagnostics/diagnostics_agg をブラウザで解析するツール',
    'header.privacy': 'データはブラウザ内で処理され、外部には一切送信されません。',

    // File upload
    'upload.click': 'ファイルを選択',
    'upload.dragDrop': 'またはドラッグ＆ドロップ',
    'upload.fileType': 'ROSbag ファイル (.bag)',

    // Loading / Error
    'loading.message': '読み込み中...',
    'error.title': '読み込みエラー',
    'status.loadedRosout': 'rosout {messageCount} 件、{nodeCount} ノードを読み込みました',
    'status.loadedRosoutDiagnostics': 'rosout {messageCount} 件、{nodeCount} ノード、診断状態の変化 {diagnosticCount} 件を読み込みました',

    // Tabs
    'tab.rosout': 'Rosout',
    'tab.diagnostics': 'Diagnostics',

    // Filters
    'filter.title': '絞り込み',
    'filter.mode': '条件の組み合わせ',
    'filter.mode.or': 'OR（いずれかに一致）',
    'filter.mode.and': 'AND（すべてに一致）',
    'filter.severity': '重大度',
    'filter.nodes': 'ノード',
    'filter.selectAll': 'すべて選択',
    'filter.clear': 'クリア',
    'filter.messageType': 'メッセージ検索',
    'filter.keywords': 'キーワード',
    'filter.regex': '正規表現',
    'filter.keywordsLabel': 'キーワード（カンマ区切り）',
    'filter.regexLabel': '正規表現パターン',
    'filter.keywordsPlaceholder': '例: error, timeout, connection',
    'filter.regexPlaceholder': '例: error.*timeout|connection.*failed',
    'filter.apply': '適用',
    'filter.clearAll': 'リセット',
    'filter.levels': 'レベル',
    'filter.names': '名前',

    // Statistics
    'stats.title': '統計',
    'stats.show': '統計を表示',
    'stats.hide': '統計を隠す',
    'stats.bySeverity': '重大度別',
    'stats.topNodes': '上位5ノード',

    // Export
    'export.title': 'エクスポート',
    'export.messages': '件',
    'export.stateChanges': '件',

    // Table
    'table.messages': 'メッセージ一覧',
    'table.diagnosticsTitle': 'Diagnostics 状態遷移',
    'table.show': '表示件数:',
    'table.time': '時刻',
    'table.node': 'ノード',
    'table.level': 'レベル',
    'table.message': 'メッセージ',
    'table.name': '名前',
    'table.details': '詳細',
    'table.valuesCount': '値 {count} 件',
    'table.timezone.local': 'ローカル',
    'table.timezone.utc': 'UTC',
    'table.preview.messages': '{totalCount} 件中 {shownCount} 件を表示',
    'table.preview.stateChanges': '{totalCount} 件中 {shownCount} 件を表示',
    'table.expandDetails': '{name} の詳細を表示',
    'table.collapseDetails': '{name} の詳細を隠す',

    // Empty state
    'empty.rosout': '条件に一致するメッセージはありません。',
    'empty.diagnostics': '条件に一致する診断情報はありません。',

    // Footer
    'footer.offline': 'オフラインでも利用できます。すべての処理はブラウザ内で行われます。',
    'footer.source': 'GitHub でソースを見る',
  },
};

function formatMessage(template: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce((message, [key, value]) => {
    return message.split(`{${key}}`).join(String(value));
  }, template);
}

function detectLang(): Lang {
  const stored = localStorage.getItem('lang');
  if (stored === 'ja' || stored === 'en') return stored;
  return navigator.language.startsWith('ja') ? 'ja' : 'en';
}

export function useI18n() {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem('lang', newLang);
    document.documentElement.lang = newLang;
  }, []);

  const t = useCallback((key: string): string => {
    return dictionaries[lang][key] ?? dictionaries['en'][key] ?? key;
  }, [lang]);

  const tf = useCallback((key: string, params: Record<string, string | number>): string => {
    return formatMessage(t(key), params);
  }, [t]);

  return { lang, setLang, t, tf };
}
