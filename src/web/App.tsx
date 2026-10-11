import { useRef, useState, useEffect, useMemo, Fragment, lazy, Suspense } from 'react';
import { Upload, Filter, Download, BarChart3, Github, ChevronDown, ChevronRight } from 'lucide-react';
import { assertNever, isReindexFailureLike, type ReindexMeta, type ReindexWarning } from '../core/reindexUtils';
import type { RosoutMessage, DiagnosticStatusEntry, SeverityLevel, TopicInfo, ProgressInfo } from '../core/types';
import { BagLoadError, SEVERITY_LEVELS, DIAGNOSTIC_LEVEL_NAMES } from '../core/types';
import { SEVERITY_COLORS, SEVERITY_BG_COLORS, DIAGNOSTIC_LEVEL_COLORS, DIAGNOSTIC_LEVEL_BG_COLORS } from './severityStyles';
import {
  loadMessages,
  filterMessages,
  exportToCSV,
  exportToJSON,
  exportToTXT,
  exportToParquet,
  exportDiagnosticsToCSV,
  exportDiagnosticsToJSON,
  exportDiagnosticsToTXT,
  exportDiagnosticsToParquet,
  filterDiagnostics,
} from '../core/rosbagUtils';
import { fileToBagSource, downloadFile, downloadBytes } from './fileAdapter';
import { useI18n } from './i18n';
import logoUrl from './assets/logo.png';

// Conditional lazy load for LLM features (SQL console)
const SqlConsole = import.meta.env.VITE_ENABLE_LLM === '1'
  ? lazy(() => import('./llm/SqlConsole').then(m => ({ default: m.SqlConsole })))
  : null;

function formatReindexWarningKey(warning: ReindexWarning): string {
  switch (warning.code) {
    case 'truncated-tail':
      return 'reindex.warning.truncatedTail';
    case 'chunk-decompress-failed':
      return 'reindex.warning.decompressFailed';
    case 'unsupported-compression':
      return 'reindex.warning.unsupportedCompression';
    case 'chunk-record-corrupt':
      return 'reindex.warning.chunkRecordCorrupt';
    case 'missing-connection-metadata':
      return 'reindex.warning.missingConnectionMetadata';
    default:
      return assertNever(warning.code);
  }
}


function formatReindexWarningDetail(t: (key: string) => string, warning: ReindexWarning): string {
  const label = t(formatReindexWarningKey(warning));
  return warning.compression ? `${label} (${warning.compression}): ${warning.detail}` : `${label}: ${warning.detail}`;
}

/**
 * Concatenate a translated base message with the underlying error's detail.
 * Strips a trailing `.` or `。` from the base so the result reads naturally
 * across both EN and JA (`Failed to load bag file: <reason>` / `bag ファイルの読み込みに失敗しました: <reason>`).
 */
function appendErrorDetail(base: string, err: unknown): string {
  if (!(err instanceof Error)) return base;
  const trimmed = base.replace(/[.。]$/, '');
  return `${trimmed}: ${err.message}`;
}

function App() {
  const { lang, setLang, t, tf } = useI18n();
  const [messages, setMessages] = useState<RosoutMessage[]>([]);
  const [filteredMessages, setFilteredMessages] = useState<RosoutMessage[]>([]);
  const [uniqueNodes, setUniqueNodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string>('');

  // Filter states
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedSeverities, setSelectedSeverities] = useState<Set<SeverityLevel>>(new Set());
  const [keywords, setKeywords] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [filterMode, setFilterMode] = useState<'OR' | 'AND'>('OR');
  const [showStats, setShowStats] = useState(false);
  const [timezone, setTimezone] = useState<'local' | 'utc'>('local');

  // Diagnostics states
  const [diagnostics, setDiagnostics] = useState<DiagnosticStatusEntry[]>([]);
  const [filteredDiagnostics, setFilteredDiagnostics] = useState<DiagnosticStatusEntry[]>([]);
  const [hasDiagnostics, setHasDiagnostics] = useState(false);
  const [activeTab, setActiveTab] = useState<'rosout' | 'diagnostics'>('rosout');
  const [expandedDiagRows, setExpandedDiagRows] = useState<Set<number>>(new Set());
  const [previewLimit, setPreviewLimit] = useState<number>(100);

  // Diagnostics filter states
  const [diagSelectedNames, setDiagSelectedNames] = useState<Set<string>>(new Set());
  const [diagSelectedLevels, setDiagSelectedLevels] = useState<Set<number>>(new Set());
  const [diagKeywords, setDiagKeywords] = useState('');
  const [diagRegexPattern, setDiagRegexPattern] = useState('');
  const [diagUseRegex, setDiagUseRegex] = useState(false);
  const [diagFilterMode, setDiagFilterMode] = useState<'OR' | 'AND'>('OR');

  // List search states
  const [nodeSearch, setNodeSearch] = useState('');
  const [diagNameSearch, setDiagNameSearch] = useState('');

  // Time range filter states
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [diagTimeStart, setDiagTimeStart] = useState('');
  const [diagTimeEnd, setDiagTimeEnd] = useState('');
  const [exportIgnoresTimeFilter, setExportIgnoresTimeFilter] = useState(false);
  const prevTimezoneRef = useRef(timezone);

  // Reindexed bag download state
  const [reindexedBytes, setReindexedBytes] = useState<Uint8Array | null>(null);
  const [reindexMeta, setReindexMeta] = useState<ReindexMeta | null>(null);
  const [reindexBlockers, setReindexBlockers] = useState<readonly ReindexWarning[] | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [loadCompleted, setLoadCompleted] = useState(false);
  const [availableTopics, setAvailableTopics] = useState<TopicInfo[]>([]);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setReindexedBytes(null);
    setReindexMeta(null);
    setReindexBlockers(null);
    setUploadedFileName(file.name);
    setLoadCompleted(false);
    setAvailableTopics([]);

    try {
      const source = fileToBagSource(file);
      const result = await loadMessages(source, setProgress);

      if (result.reindexedBytes) {
        setReindexedBytes(result.reindexedBytes);
      }
      if (result.reindexMeta) {
        setReindexMeta(result.reindexMeta);
      }

      setMessages(result.messages);
      setFilteredMessages(result.messages);
      setUniqueNodes(result.uniqueNodes);
      setDiagnostics(result.diagnostics);
      setFilteredDiagnostics(result.diagnostics);
      setHasDiagnostics(result.hasDiagnostics);
      setSelectedNodes(new Set());
      setSelectedSeverities(new Set());
      setDiagSelectedNames(new Set());
      setDiagSelectedLevels(new Set());
      setDiagKeywords('');
      setDiagRegexPattern('');
      setExpandedDiagRows(new Set());
      setNodeSearch('');
      setDiagNameSearch('');
      setTimeStart('');
      setTimeEnd('');
      setDiagTimeStart('');
      setDiagTimeEnd('');
      setExportIgnoresTimeFilter(false);
      setActiveTab(result.messages.length > 0 ? 'rosout' : 'diagnostics');
      setAvailableTopics(result.availableTopics);
      setLoadCompleted(true);
    } catch (err) {
      console.error('File upload failed:', err);
      if (isReindexFailureLike(err)) {
        setReindexBlockers(err.blockers);
        setError(t('error.reindexFailed'));
      } else if (err instanceof BagLoadError) {
        setError(tf(err.code, err.params));
      } else {
        setError(appendErrorDetail(t('error.failedToLoad'), err));
      }
    } finally {
      setProgress(null);
      setLoading(false);
    }
  };

  const applyFilters = () => {
    const filtered = filterMessages(messages, {
      nodeNames: selectedNodes.size > 0 ? selectedNodes : undefined,
      severityLevels: selectedSeverities.size > 0 ? selectedSeverities : undefined,
      messageKeywords: keywords ? keywords.split(',').map(k => k.trim()) : undefined,
      messageRegex: useRegex ? regexPattern : undefined,
      filterMode,
      useRegex,
      startTime: datetimeLocalToEpoch(timeStart),
      endTime: datetimeLocalToEpoch(timeEnd),
    });
    setFilteredMessages(filtered);
  };

  const handleExport = async (format: 'csv' | 'json' | 'txt' | 'parquet') => {
    try {
      setError('');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      let content: string | Uint8Array;
      let filename: string;
      let type: string;

      if (activeTab === 'diagnostics') {
        // If ignoring time filter, re-filter without time range
        const exportData = (exportIgnoresTimeFilter && hasDiagTimeFilter)
          ? filterDiagnostics(diagnostics, {
              levels: diagSelectedLevels,
              names: diagSelectedNames,
              messageKeywords: diagUseRegex ? undefined : diagKeywords,
              messageRegex: diagUseRegex ? diagRegexPattern : undefined,
              filterMode: diagFilterMode,
              useRegex: diagUseRegex,
            })
          : filteredDiagnostics;
        const prefix = 'diagnostics_export';
        switch (format) {
          case 'csv':
            content = exportDiagnosticsToCSV(exportData, timezone);
            filename = `${prefix}_${timestamp}.csv`;
            type = 'text/csv';
            break;
          case 'json':
            content = exportDiagnosticsToJSON(exportData, timezone);
            filename = `${prefix}_${timestamp}.json`;
            type = 'application/json';
            break;
          case 'txt':
            content = exportDiagnosticsToTXT(exportData, timezone);
            filename = `${prefix}_${timestamp}.txt`;
            type = 'text/plain';
            break;
          case 'parquet':
            content = exportDiagnosticsToParquet(exportData, timezone);
            filename = `${prefix}_${timestamp}.parquet`;
            type = 'application/vnd.apache.parquet';
            break;
          default: {
            const exhaustiveFormat: never = format;
            throw new BagLoadError('error.unsupportedFormat', { format: String(exhaustiveFormat) });
          }
        }
      } else {
        // If ignoring time filter, re-filter without time range
        const exportData = (exportIgnoresTimeFilter && hasTimeFilter)
          ? filterMessages(messages, {
              nodeNames: selectedNodes.size > 0 ? selectedNodes : undefined,
              severityLevels: selectedSeverities.size > 0 ? selectedSeverities : undefined,
              messageKeywords: keywords ? keywords.split(',').map(k => k.trim()) : undefined,
              messageRegex: useRegex ? regexPattern : undefined,
              filterMode,
              useRegex,
            })
          : filteredMessages;
        switch (format) {
          case 'csv':
            content = exportToCSV(exportData, timezone);
            filename = `rosout_export_${timestamp}.csv`;
            type = 'text/csv';
            break;
          case 'json':
            content = exportToJSON(exportData, timezone);
            filename = `rosout_export_${timestamp}.json`;
            type = 'application/json';
            break;
          case 'txt':
            content = exportToTXT(exportData, timezone);
            filename = `rosout_export_${timestamp}.txt`;
            type = 'text/plain';
            break;
          case 'parquet':
            content = exportToParquet(exportData, timezone);
            filename = `rosout_export_${timestamp}.parquet`;
            type = 'application/vnd.apache.parquet';
            break;
          default: {
            const exhaustiveFormat: never = format;
            throw new BagLoadError('error.unsupportedFormat', { format: String(exhaustiveFormat) });
          }
        }
      }

      downloadFile(content, filename, type);
    } catch (err) {
      if (err instanceof BagLoadError) {
        setError(tf(err.code, err.params));
      } else {
        setError(appendErrorDetail(t('error.failedToExport'), err));
      }
    }
  };

  const toggleDiagRow = (idx: number) => {
    const newSet = new Set(expandedDiagRows);
    if (newSet.has(idx)) {
      newSet.delete(idx);
    } else {
      newSet.add(idx);
    }
    setExpandedDiagRows(newSet);
  };

  const toggleDiagName = (name: string) => {
    const newSet = new Set(diagSelectedNames);
    if (newSet.has(name)) { newSet.delete(name); } else { newSet.add(name); }
    setDiagSelectedNames(newSet);
  };

  const toggleDiagLevel = (level: number) => {
    const newSet = new Set(diagSelectedLevels);
    if (newSet.has(level)) { newSet.delete(level); } else { newSet.add(level); }
    setDiagSelectedLevels(newSet);
  };

  const uniqueDiagNames = new Set(diagnostics.map(d => d.name));

  const applyDiagFilters = () => {
    const filtered = filterDiagnostics(diagnostics, {
      levels: diagSelectedLevels,
      names: diagSelectedNames,
      messageKeywords: diagUseRegex ? undefined : diagKeywords,
      messageRegex: diagUseRegex ? diagRegexPattern : undefined,
      filterMode: diagFilterMode,
      useRegex: diagUseRegex,
      startTime: datetimeLocalToEpoch(diagTimeStart),
      endTime: datetimeLocalToEpoch(diagTimeEnd),
    });
    setFilteredDiagnostics(filtered);
    setExpandedDiagRows(new Set());
  };

  const toggleNode = (node: string) => {
    const newSet = new Set(selectedNodes);
    if (newSet.has(node)) {
      newSet.delete(node);
    } else {
      newSet.add(node);
    }
    setSelectedNodes(newSet);
  };

  const toggleSeverity = (severity: SeverityLevel) => {
    const newSet = new Set(selectedSeverities);
    if (newSet.has(severity)) {
      newSet.delete(severity);
    } else {
      newSet.add(severity);
    }
    setSelectedSeverities(newSet);
  };

  const getStatistics = () => {
    const severityCount: Record<SeverityLevel, number> = {} as Record<SeverityLevel, number>;
    const nodeCount: Record<string, number> = {};

    filteredMessages.forEach(msg => {
      severityCount[msg.severity] = (severityCount[msg.severity] || 0) + 1;
      nodeCount[msg.node] = (nodeCount[msg.node] || 0) + 1;
    });

    const topNodes = Object.entries(nodeCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    return { severityCount, topNodes };
  };

  const stats = getStatistics();

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    if (timezone === 'utc') {
      return date.toISOString().replace('T', ' ').substring(0, 23) + ' UTC';
    } else {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const ms = String(date.getMilliseconds()).padStart(3, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
    }
  };

  // Time range helpers
  const datetimeLocalToEpoch = (dtStr: string): number | undefined => {
    if (!dtStr) return undefined;
    if (timezone === 'utc') {
      return new Date(dtStr + 'Z').getTime() / 1000;
    } else {
      return new Date(dtStr).getTime() / 1000;
    }
  };

  const epochToDatetimeLocal = (epoch: number): string => {
    const date = new Date(epoch * 1000);
    if (timezone === 'utc') {
      return date.toISOString().slice(0, 19);
    } else {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }
  };

  const messageTimeRange = useMemo(() => {
    if (messages.length === 0) return null;
    let min = messages[0].timestamp;
    let max = messages[0].timestamp;
    for (const m of messages) {
      if (m.timestamp < min) min = m.timestamp;
      if (m.timestamp > max) max = m.timestamp;
    }
    return { min, max };
  }, [messages]);

  const diagTimeRange = useMemo(() => {
    if (diagnostics.length === 0) return null;
    let min = diagnostics[0].timestamp;
    let max = diagnostics[0].timestamp;
    for (const d of diagnostics) {
      if (d.timestamp < min) min = d.timestamp;
      if (d.timestamp > max) max = d.timestamp;
    }
    return { min, max };
  }, [diagnostics]);

  // Convert time inputs when timezone toggles so they refer to the same instant
  useEffect(() => {
    const prev = prevTimezoneRef.current;
    if (prev === timezone) return;
    const convert = (dtStr: string): string => {
      if (!dtStr) return '';
      // Parse with previous timezone
      const epoch = prev === 'utc'
        ? new Date(dtStr + 'Z').getTime() / 1000
        : new Date(dtStr).getTime() / 1000;
      // Format with new timezone
      const date = new Date(epoch * 1000);
      if (timezone === 'utc') {
        return date.toISOString().slice(0, 19);
      } else {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      }
    };
    setTimeStart(s => convert(s));
    setTimeEnd(s => convert(s));
    setDiagTimeStart(s => convert(s));
    setDiagTimeEnd(s => convert(s));
    prevTimezoneRef.current = timezone;
  }, [timezone]);

  const hasTimeFilter = timeStart !== '' || timeEnd !== '';
  const hasDiagTimeFilter = diagTimeStart !== '' || diagTimeEnd !== '';

  const hasData = messages.length > 0 || diagnostics.length > 0;

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 bg-grid">
      <div className="container mx-auto px-4 py-8 max-w-6xl">

        {/* Header */}
        <header className="mb-10 animate-fade-in">
          <div className="flex justify-end mb-2">
            <div className="flex gap-0.5 p-0.5 bg-surface-200/60 dark:bg-surface-800/60 rounded-md">
              <button
                onClick={() => setLang('ja')}
                className={`btn-chip px-2 py-0.5 text-xs font-medium rounded ${
                  lang === 'ja'
                    ? 'bg-surface-50 dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
              >
                JA
              </button>
              <button
                onClick={() => setLang('en')}
                className={`btn-chip px-2 py-0.5 text-xs font-medium rounded ${
                  lang === 'en'
                    ? 'bg-surface-50 dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
              >
                EN
              </button>
            </div>
          </div>
          <div className="text-center">
            <img src={logoUrl} alt="ROSbag Analyzer" className="mx-auto h-28 sm:h-36 mb-3" />
            <h1 className="sr-only">ROSbag Analyzer</h1>
            <p className="text-surface-600 dark:text-surface-300 text-sm mx-auto leading-relaxed">
              {t('header.description')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400 tracking-wide">
              {t('header.privacy')}
            </p>
          </div>
        </header>

        {/* File Upload */}
        <div className="animate-fade-in stagger-1 mb-10">
          <div
            className={`drop-zone flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl ${
              isDragging
                ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20'
                : 'border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900'
            }`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setIsDragging(false);
              const files = e.dataTransfer?.files;
              if (!files || files.length === 0) return;
              const fileInput = fileInputRef.current;
              if (!fileInput || fileInput.disabled) return;
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(files[0]);
              fileInput.files = dataTransfer.files;
              handleFileUpload({ target: fileInput } as React.ChangeEvent<HTMLInputElement>);
            }}
          >
            <div className="flex flex-col items-center justify-center py-6">
              <Upload className={`w-8 h-8 mb-3 transition-colors ${isDragging ? 'text-brand-500' : 'text-surface-400'}`} />
              <button
                type="button"
                onClick={openFilePicker}
                disabled={loading}
                className="btn-primary px-4 py-2 text-sm font-semibold rounded-lg"
              >
                {t('upload.click')}
              </button>
              <p className="mt-3 text-sm text-surface-600 dark:text-surface-400">{t('upload.dragDrop')}</p>
              <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">{t('upload.fileType')}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".bag,.mcap,.mcap.zstd"
              onChange={handleFileUpload}
              disabled={loading}
              data-testid="bag-upload-input"
            />
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="mb-8">
            <div
              className="h-1.5 w-full bg-surface-200 dark:bg-surface-800 rounded-full overflow-hidden"
              role="progressbar"
              aria-label={progress != null ? t(`progress.phase.${progress.phase}`) : t('loading.message')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                progress?.processed != null && progress?.total != null && progress.total > 0
                  ? Math.round((progress.processed / progress.total) * 100)
                  : undefined
              }
              data-testid="load-progress"
            >
              {progress?.processed != null && progress?.total != null && progress.total > 0 ? (
                <div
                  className="progress-bar h-full w-full bg-gradient-to-r from-brand-400 to-brand-600"
                  style={{ transform: `scaleX(${progress.processed / progress.total})` }}
                />
              ) : (
                <div className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full loading-bar" />
              )}
            </div>
            <p className="mt-3 text-center text-sm text-surface-500 dark:text-surface-400">
              {progress != null
                ? t(`progress.phase.${progress.phase}`)
                : uploadedFileName
                  ? tf('loading.withFileName', { fileName: uploadedFileName })
                  : t('loading.message')}
            </p>
            {progress != null && (
              <p className="mt-1 text-center text-xs text-surface-400 dark:text-surface-500">
                {tf('progress.parsed', { count: progress.messageCount.toLocaleString() })}
                {` (${(progress.fileSize / (1024 * 1024)).toFixed(1)} MB)`}
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded-xl" data-testid="error-panel">
            <p className="text-red-700 dark:text-red-400 font-semibold text-sm mb-1">{t('error.title')}</p>
            <pre className="text-xs text-red-600 dark:text-red-300 whitespace-pre-wrap overflow-x-auto font-mono">{error}</pre>
            {reindexBlockers && reindexBlockers.length > 0 && (
              <div className="mt-3" data-testid="reindex-blockers">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                  {t('reindex.blockersTitle')}
                </p>
                <ul className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-300">
                  {reindexBlockers.map((warning, index) => (
                    <li
                      key={`${warning.code}-${warning.chunkOffset}-${index}`}
                      data-testid="reindex-blocker-item"
                      data-code={warning.code}
                    >
                      {formatReindexWarningDetail(t, warning)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Success */}
        {loadCompleted && !loading && hasData && (
          <div className="mb-8">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2 rounded-full">
              {hasDiagnostics
                ? tf('status.loadedRosoutDiagnostics', {
                    messageCount: messages.length.toLocaleString(),
                    nodeCount: uniqueNodes.size,
                    diagnosticCount: diagnostics.length.toLocaleString(),
                  })
                : tf('status.loadedRosout', {
                    messageCount: messages.length.toLocaleString(),
                    nodeCount: uniqueNodes.size,
                  })}
            </p>
          </div>
        )}

        {/* Loaded but empty */}
        {loadCompleted && !loading && !hasData && (
          <div className="mb-8 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-xl" data-testid="empty-result-panel">
            <p className="text-sm text-amber-800 dark:text-amber-300 mb-2">
              {tf('status.loadedNoMessages', { fileName: uploadedFileName })}
            </p>
            {availableTopics.length > 0 ? (
              <details className="text-xs text-amber-800 dark:text-amber-300">
                <summary className="cursor-pointer select-none font-medium">
                  {tf('status.otherTopics', { count: availableTopics.length })}
                </summary>
                <ul className="mt-2 space-y-0.5 font-mono leading-relaxed" data-testid="available-topics">
                  {availableTopics.map((info, i) => (
                    <li key={`${info.topic}-${i}`}>
                      <span>{info.topic}</span>
                      <span className="text-amber-700 dark:text-amber-400/80"> [{info.type}]</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="text-xs text-amber-800 dark:text-amber-300">{t('status.noOtherTopics')}</p>
            )}
          </div>
        )}

        {/* Reindexed notification */}
        {reindexedBytes && hasData && !loading && (
          <div
            className={`mb-8 p-4 border rounded-xl ${
              reindexMeta?.partial
                ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50'
                : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50'
            }`}
            data-testid="reindex-notice"
          >
            <p className={`text-sm mb-2.5 ${reindexMeta?.partial ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
              <span className="font-semibold">
                {reindexMeta?.partial ? t('reindex.partialBold') : t('reindex.noticeBold')}
              </span>{' '}
              {reindexMeta?.partial ? t('reindex.partialBody') : t('reindex.noticeBody')}
            </p>
            {reindexMeta?.partial && (
              <div className="mb-3 text-sm text-amber-800 dark:text-amber-300" data-testid="reindex-warning">
                <p className="font-medium">
                  {tf('reindex.partialSummary', {
                    recovered: reindexMeta.chunksRecovered,
                    seen: reindexMeta.chunksSeen,
                    skipped: reindexMeta.chunksSkipped,
                  })}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer select-none font-medium">
                    {t('reindex.partialDetails')}
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed" data-testid="reindex-warning-details">
                    {reindexMeta.warnings.map((warning, index) => (
                      <li key={`${warning.code}-${warning.chunkOffset}-${index}`}>
                        {formatReindexWarningDetail(t, warning)}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            <button
              type="button"
              onClick={() => downloadBytes(reindexedBytes, uploadedFileName || 'reindexed.bag')}
              data-testid="download-reindexed"
              className={`btn-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border ${
                reindexMeta?.partial
                  ? 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 bg-white/60 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                  : 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 bg-white/60 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
              }`}
            >
              <Download className="w-4 h-4" />
              {t('reindex.download')}
            </button>
          </div>
        )}

        {/* Tabs */}
        {hasDiagnostics && hasData && (
          <div className="flex gap-1 mb-6 p-1 bg-surface-200/60 dark:bg-surface-800/60 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab('rosout')}
              data-testid="rosout-tab"
              className={`btn-chip px-5 py-2 text-sm font-medium rounded-md ${
                activeTab === 'rosout'
                  ? 'bg-surface-50 dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
              }`}
            >
              {t('tab.rosout')}
              <span className={`ml-1.5 text-xs font-mono ${activeTab === 'rosout' ? 'text-brand-600 dark:text-brand-400' : 'text-surface-400'}`}>
                {filteredMessages.length.toLocaleString()}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('diagnostics')}
              data-testid="diagnostics-tab"
              className={`btn-chip px-5 py-2 text-sm font-medium rounded-md ${
                activeTab === 'diagnostics'
                  ? 'bg-surface-50 dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
              }`}
            >
              {t('tab.diagnostics')}
              <span className={`ml-1.5 text-xs font-mono ${activeTab === 'diagnostics' ? 'text-brand-600 dark:text-brand-400' : 'text-surface-400'}`}>
                {filteredDiagnostics.length.toLocaleString()}
              </span>
            </button>
          </div>
        )}

        {/* Filters (rosout tab only) */}
        {activeTab === 'rosout' && messages.length > 0 && (
          <div className="card p-6 mb-4">
            <div className="flex items-center mb-5">
              <Filter className="w-4 h-4 mr-2 text-brand-600 dark:text-brand-400" />
              <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-100">{t('filter.title')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Filter Mode */}
              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">
                  {t('filter.mode')}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={filterMode === 'OR'} onChange={() => setFilterMode('OR')} className="input-check mr-2" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.mode.or')}</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={filterMode === 'AND'} onChange={() => setFilterMode('AND')} className="input-check mr-2" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.mode.and')}</span>
                  </label>
                </div>
              </div>

              {/* Severity Levels */}
              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">
                  {t('filter.severity')}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SEVERITY_LEVELS.map((level) => (
                    <button
                      key={level}
                      onClick={() => toggleSeverity(level)}
                      className={`btn-chip px-3 py-1 rounded-md text-xs font-medium ${
                        selectedSeverities.has(level)
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nodes */}
              <div className="md:col-span-2 text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-surface-400">
                    {t('filter.nodes')} ({uniqueNodes.size})
                  </label>
                  <div className="flex gap-2">
                    {nodeSearch ? (
                      <>
                        <button onClick={() => { const filtered = Array.from(uniqueNodes).filter(n => n.toLowerCase().includes(nodeSearch.toLowerCase())); setSelectedNodes(new Set([...selectedNodes, ...filtered])); }} className="btn-link text-xs">
                          {t('filter.selectFiltered')}
                        </button>
                        <button onClick={() => { const filtered = new Set(Array.from(uniqueNodes).filter(n => n.toLowerCase().includes(nodeSearch.toLowerCase()))); const next = new Set([...selectedNodes].filter(n => !filtered.has(n))); setSelectedNodes(next); }} className="btn-link text-xs">
                          {t('filter.deselectFiltered')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setSelectedNodes(new Set(uniqueNodes))} className="btn-link text-xs">
                          {t('filter.selectAll')}
                        </button>
                        <button onClick={() => setSelectedNodes(new Set())} className="btn-link text-xs">
                          {t('filter.clear')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={nodeSearch}
                  onChange={e => setNodeSearch(e.target.value)}
                  placeholder={t('filter.searchPlaceholder')}
                  className="input-field px-3 py-1.5 mb-1.5 text-xs"
                />
                <div className="max-h-32 overflow-y-auto border border-surface-200 dark:border-surface-700 rounded-lg p-2 bg-surface-50 dark:bg-surface-800/50">
                  {Array.from(uniqueNodes).sort().filter(node => !nodeSearch || node.toLowerCase().includes(nodeSearch.toLowerCase())).map(node => (
                    <label key={node} className="flex items-center py-1 cursor-pointer">
                      <input type="checkbox" checked={selectedNodes.has(node)} onChange={() => toggleNode(node)} className="input-check mr-2" />
                      <span className="text-xs text-surface-700 dark:text-surface-300 font-mono">{node}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Message Search: type toggle + input */}
              <div className="md:col-span-2 text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-surface-400">
                    {t('filter.messageType')}
                  </label>
                  <div className="flex gap-3">
                    <label className="flex items-center cursor-pointer">
                      <input type="radio" checked={!useRegex} onChange={() => setUseRegex(false)} className="input-check mr-1.5" />
                      <span className="text-xs text-surface-600 dark:text-surface-400">{t('filter.keywords')}</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input type="radio" checked={useRegex} onChange={() => setUseRegex(true)} className="input-check mr-1.5" />
                      <span className="text-xs text-surface-600 dark:text-surface-400">{t('filter.regex')}</span>
                    </label>
                  </div>
                </div>
                <input
                  type="text"
                  value={useRegex ? regexPattern : keywords}
                  onChange={e => (useRegex ? setRegexPattern(e.target.value) : setKeywords(e.target.value))}
                  placeholder={useRegex ? t('filter.regexPlaceholder') : t('filter.keywordsPlaceholder')}
                  className="input-field px-3 py-2 text-sm"
                />
              </div>

              {/* Time Range */}
              <div className="md:col-span-2 text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-surface-400">
                    {t('filter.timeRange')}
                    <span className="ml-1.5 font-normal text-surface-400 font-mono">
                      ({timezone === 'utc' ? 'UTC' : t('table.timezone.local')})
                    </span>
                  </label>
                  {messageTimeRange && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setTimeStart(epochToDatetimeLocal(Math.floor(messageTimeRange.min))); setTimeEnd(epochToDatetimeLocal(Math.ceil(messageTimeRange.max))); }}
                        className="btn-link text-xs"
                      >
                        {t('filter.timeSetRange')}
                      </button>
                      {(timeStart || timeEnd) && (
                        <button
                          onClick={() => { setTimeStart(''); setTimeEnd(''); }}
                          className="btn-link text-xs"
                        >
                          {t('filter.clear')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-surface-400 mb-1">{t('filter.timeStart')}</label>
                    <input
                      type="datetime-local"
                      step="1"
                      value={timeStart}
                      onChange={e => setTimeStart(e.target.value)}
                      min={messageTimeRange ? epochToDatetimeLocal(messageTimeRange.min) : undefined}
                      max={messageTimeRange ? epochToDatetimeLocal(messageTimeRange.max) : undefined}
                      placeholder={messageTimeRange ? formatTime(messageTimeRange.min) : undefined}
                      className="input-field px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-surface-400 mb-1">{t('filter.timeEnd')}</label>
                    <input
                      type="datetime-local"
                      step="1"
                      value={timeEnd}
                      onChange={e => setTimeEnd(e.target.value)}
                      min={messageTimeRange ? epochToDatetimeLocal(messageTimeRange.min) : undefined}
                      max={messageTimeRange ? epochToDatetimeLocal(messageTimeRange.max) : undefined}
                      placeholder={messageTimeRange ? formatTime(messageTimeRange.max) : undefined}
                      className="input-field px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                {messageTimeRange && (
                  <p className="mt-1.5 text-xs text-surface-400 font-mono">
                    {tf('filter.timeRangeHint', {
                      start: formatTime(messageTimeRange.min),
                      end: formatTime(messageTimeRange.max),
                    })}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={applyFilters} className="btn-primary px-5 py-2 text-sm rounded-lg font-medium">
                {t('filter.apply')}
              </button>
              <button
                onClick={() => { setSelectedNodes(new Set()); setSelectedSeverities(new Set()); setKeywords(''); setRegexPattern(''); setTimeStart(''); setTimeEnd(''); setFilteredMessages(messages); }}
                className="btn-secondary px-5 py-2 text-sm rounded-lg font-medium"
              >
                {t('filter.clearAll')}
              </button>
              <button
                onClick={() => setShowStats(!showStats)}
                className="btn-secondary px-5 py-2 text-sm rounded-lg font-medium flex items-center gap-2"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                {showStats ? t('stats.hide') : t('stats.show')}
              </button>
            </div>
          </div>
        )}

        {/* Statistics (rosout tab only) */}
        {activeTab === 'rosout' && showStats && filteredMessages.length > 0 && (
          <div className="card p-6 mb-4">
            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-100 mb-4">{t('stats.title')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-3">{t('stats.bySeverity')}</h3>
                {Object.entries(stats.severityCount).map(([level, count]) => {
                  const percentage = ((count / filteredMessages.length) * 100).toFixed(1);
                  return (
                    <div key={level} className="flex justify-between items-center py-1.5">
                      <span className={`text-sm font-medium ${SEVERITY_COLORS[level as SeverityLevel]}`}>{level}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${percentage}%` }} />
                        </div>
                        <span className="text-xs text-surface-500 dark:text-surface-400 font-mono w-20 text-right">{count} ({percentage}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <h3 className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-3">{t('stats.topNodes')}</h3>
                {stats.topNodes.map(([node, count]) => {
                  const percentage = ((count / filteredMessages.length) * 100).toFixed(1);
                  return (
                    <div key={node} className="flex justify-between items-center py-1.5">
                      <span className="text-xs text-surface-700 dark:text-surface-300 truncate flex-1 font-mono">{node}</span>
                      <span className="text-xs text-surface-500 dark:text-surface-400 font-mono ml-2">{count} ({percentage}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Export (rosout) */}
        {activeTab === 'rosout' && filteredMessages.length > 0 && (
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Download className="w-4 h-4 text-surface-400" />
                <div>
                  <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{t('export.title')}</span>
                  <span className="text-xs text-surface-400 ml-2">{filteredMessages.length.toLocaleString()} {t('export.messages')}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {hasTimeFilter && (
                  <label className="flex items-center gap-1.5 cursor-pointer" title={t('export.ignoreTimeFilterTooltip')}>
                    <input
                      type="checkbox"
                      checked={exportIgnoresTimeFilter}
                      onChange={e => setExportIgnoresTimeFilter(e.target.checked)}
                      className="input-check"
                    />
                    <span className="text-xs text-surface-500 dark:text-surface-400 underline decoration-dotted decoration-surface-400">{t('export.ignoreTimeFilter')}</span>
                  </label>
                )}
                <div className="flex gap-2">
                  <button onClick={() => handleExport('csv')} className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-md">CSV</button>
                  <button onClick={() => handleExport('json')} className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-md">JSON</button>
                  <button onClick={() => handleExport('txt')} className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-md">TXT</button>
                  <button
                    onClick={() => handleExport('parquet')}
                    data-testid="export-rosout-parquet"
                    className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-md"
                  >
                    Parquet
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Messages Table (rosout) */}
        {activeTab === 'rosout' && filteredMessages.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                {t('table.messages')} <span className="ml-2 text-xs font-mono text-surface-400">{filteredMessages.length.toLocaleString()}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <div className="flex items-center gap-1 bg-surface-100/60 dark:bg-surface-800/40 rounded-md p-0.5">
                  <span className="text-xs text-surface-400 px-1.5">{t('table.show')}</span>
                  {[100, 500, 1000, 5000, 10000].map(n => (
                    <button key={n} onClick={() => setPreviewLimit(n)} className={`btn-chip min-w-[2.5rem] px-1.5 py-0.5 text-xs font-mono rounded text-center ${previewLimit === n ? 'bg-brand-600 text-white shadow-sm' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:bg-surface-200/60 dark:hover:bg-surface-700/40'}`}>{n.toLocaleString()}</button>
                  ))}
                </div>
                <button onClick={() => setTimezone(timezone === 'local' ? 'utc' : 'local')} className="btn-chip px-2.5 py-0.5 text-xs font-mono rounded bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
                  {timezone === 'local' ? t('table.timezone.local') : t('table.timezone.utc')}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-100/50 dark:bg-surface-800/50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">{t('table.time')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">{t('table.node')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">{t('table.level')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">{t('table.message')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-800/50">
                  {filteredMessages.slice(0, previewLimit).map((msg, idx) => (
                    <tr key={idx} className={`${SEVERITY_BG_COLORS[msg.severity]} hover:bg-surface-100/50 dark:hover:bg-surface-800/30 transition-colors`}>
                      <td className="px-4 py-2 text-xs text-surface-700 dark:text-surface-300 whitespace-nowrap font-mono">{formatTime(msg.timestamp)}</td>
                      <td className="px-4 py-2 text-xs text-surface-600 dark:text-surface-400 whitespace-nowrap font-mono">{msg.node}</td>
                      <td className={`px-4 py-2 text-xs font-medium whitespace-nowrap ${SEVERITY_COLORS[msg.severity]}`}>{msg.severity}</td>
                      <td className="px-4 py-2 text-xs text-surface-800 dark:text-surface-200">{msg.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredMessages.length > previewLimit && (
              <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-800 text-center text-xs text-surface-400">
                {tf('table.preview.messages', {
                  shownCount: previewLimit,
                  totalCount: filteredMessages.length.toLocaleString(),
                })}
              </div>
            )}
          </div>
        )}

        {/* Empty state for rosout */}
        {activeTab === 'rosout' && messages.length > 0 && filteredMessages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-surface-400 dark:text-surface-500 text-sm">{t('empty.rosout')}</p>
          </div>
        )}

        {/* Diagnostics Filters */}
        {activeTab === 'diagnostics' && diagnostics.length > 0 && (
          <div className="card p-6 mb-4">
            <div className="flex items-center mb-5">
              <Filter className="w-4 h-4 mr-2 text-brand-600 dark:text-brand-400" />
              <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-100">{t('filter.title')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">{t('filter.mode')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={diagFilterMode === 'OR'} onChange={() => setDiagFilterMode('OR')} className="input-check mr-2" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.mode.or')}</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={diagFilterMode === 'AND'} onChange={() => setDiagFilterMode('AND')} className="input-check mr-2" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.mode.and')}</span>
                  </label>
                </div>
              </div>

              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">{t('filter.levels')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(DIAGNOSTIC_LEVEL_NAMES).map(([level, name]) => (
                    <button key={level} onClick={() => toggleDiagLevel(Number(level))} className={`btn-chip px-3 py-1 rounded-md text-xs font-medium ${diagSelectedLevels.has(Number(level)) ? 'bg-brand-600 text-white shadow-sm' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'}`}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2 text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-surface-400">{t('filter.names')} ({uniqueDiagNames.size})</label>
                  <div className="flex gap-2">
                    {diagNameSearch ? (
                      <>
                        <button onClick={() => { const filtered = Array.from(uniqueDiagNames).filter(n => n.toLowerCase().includes(diagNameSearch.toLowerCase())); setDiagSelectedNames(new Set([...diagSelectedNames, ...filtered])); }} className="btn-link text-xs">
                          {t('filter.selectFiltered')}
                        </button>
                        <button onClick={() => { const filtered = new Set(Array.from(uniqueDiagNames).filter(n => n.toLowerCase().includes(diagNameSearch.toLowerCase()))); const next = new Set([...diagSelectedNames].filter(n => !filtered.has(n))); setDiagSelectedNames(next); }} className="btn-link text-xs">
                          {t('filter.deselectFiltered')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setDiagSelectedNames(new Set(uniqueDiagNames))} className="btn-link text-xs">{t('filter.selectAll')}</button>
                        <button onClick={() => setDiagSelectedNames(new Set())} className="btn-link text-xs">{t('filter.clear')}</button>
                      </>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={diagNameSearch}
                  onChange={e => setDiagNameSearch(e.target.value)}
                  placeholder={t('filter.searchPlaceholder')}
                  className="input-field px-3 py-1.5 mb-1.5 text-xs"
                />
                <div className="max-h-32 overflow-y-auto border border-surface-200 dark:border-surface-700 rounded-lg p-2 bg-surface-50 dark:bg-surface-800/50">
                  {Array.from(uniqueDiagNames).sort().filter(name => !diagNameSearch || name.toLowerCase().includes(diagNameSearch.toLowerCase())).map(name => (
                    <label key={name} className="flex items-center py-1 cursor-pointer">
                      <input type="checkbox" checked={diagSelectedNames.has(name)} onChange={() => toggleDiagName(name)} className="input-check mr-2" />
                      <span className="text-xs text-surface-700 dark:text-surface-300 font-mono">{name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Message Search: type toggle + input */}
              <div className="md:col-span-2 text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-surface-400">
                    {t('filter.messageType')}
                  </label>
                  <div className="flex gap-3">
                    <label className="flex items-center cursor-pointer">
                      <input type="radio" checked={!diagUseRegex} onChange={() => setDiagUseRegex(false)} className="input-check mr-1.5" />
                      <span className="text-xs text-surface-600 dark:text-surface-400">{t('filter.keywords')}</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input type="radio" checked={diagUseRegex} onChange={() => setDiagUseRegex(true)} className="input-check mr-1.5" />
                      <span className="text-xs text-surface-600 dark:text-surface-400">{t('filter.regex')}</span>
                    </label>
                  </div>
                </div>
                <input
                  type="text"
                  value={diagUseRegex ? diagRegexPattern : diagKeywords}
                  onChange={e => (diagUseRegex ? setDiagRegexPattern(e.target.value) : setDiagKeywords(e.target.value))}
                  placeholder={diagUseRegex ? t('filter.regexPlaceholder') : t('filter.keywordsPlaceholder')}
                  className="input-field px-3 py-2 text-sm"
                />
              </div>

              {/* Time Range */}
              <div className="md:col-span-2 text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-surface-400">
                    {t('filter.timeRange')}
                    <span className="ml-1.5 font-normal text-surface-400 font-mono">
                      ({timezone === 'utc' ? 'UTC' : t('table.timezone.local')})
                    </span>
                  </label>
                  {diagTimeRange && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setDiagTimeStart(epochToDatetimeLocal(Math.floor(diagTimeRange.min))); setDiagTimeEnd(epochToDatetimeLocal(Math.ceil(diagTimeRange.max))); }}
                        className="btn-link text-xs"
                      >
                        {t('filter.timeSetRange')}
                      </button>
                      {(diagTimeStart || diagTimeEnd) && (
                        <button
                          onClick={() => { setDiagTimeStart(''); setDiagTimeEnd(''); }}
                          className="btn-link text-xs"
                        >
                          {t('filter.clear')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-surface-400 mb-1">{t('filter.timeStart')}</label>
                    <input
                      type="datetime-local"
                      step="1"
                      value={diagTimeStart}
                      onChange={e => setDiagTimeStart(e.target.value)}
                      min={diagTimeRange ? epochToDatetimeLocal(diagTimeRange.min) : undefined}
                      max={diagTimeRange ? epochToDatetimeLocal(diagTimeRange.max) : undefined}
                      placeholder={diagTimeRange ? formatTime(diagTimeRange.min) : undefined}
                      className="input-field px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-surface-400 mb-1">{t('filter.timeEnd')}</label>
                    <input
                      type="datetime-local"
                      step="1"
                      value={diagTimeEnd}
                      onChange={e => setDiagTimeEnd(e.target.value)}
                      min={diagTimeRange ? epochToDatetimeLocal(diagTimeRange.min) : undefined}
                      max={diagTimeRange ? epochToDatetimeLocal(diagTimeRange.max) : undefined}
                      placeholder={diagTimeRange ? formatTime(diagTimeRange.max) : undefined}
                      className="input-field px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                {diagTimeRange && (
                  <p className="mt-1.5 text-xs text-surface-400 font-mono">
                    {tf('filter.timeRangeHint', {
                      start: formatTime(diagTimeRange.min),
                      end: formatTime(diagTimeRange.max),
                    })}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={applyDiagFilters} className="btn-primary px-5 py-2 text-sm rounded-lg font-medium">{t('filter.apply')}</button>
              <button
                onClick={() => { setDiagSelectedNames(new Set()); setDiagSelectedLevels(new Set()); setDiagKeywords(''); setDiagRegexPattern(''); setDiagTimeStart(''); setDiagTimeEnd(''); setFilteredDiagnostics(diagnostics); setExpandedDiagRows(new Set()); }}
                className="btn-secondary px-5 py-2 text-sm rounded-lg font-medium"
              >
                {t('filter.clearAll')}
              </button>
            </div>
          </div>
        )}

        {/* Export (diagnostics) */}
        {activeTab === 'diagnostics' && filteredDiagnostics.length > 0 && (
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Download className="w-4 h-4 text-surface-400" />
                <div>
                  <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{t('export.title')}</span>
                  <span className="text-xs text-surface-400 ml-2">{filteredDiagnostics.length.toLocaleString()} {t('export.stateChanges')}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {hasDiagTimeFilter && (
                  <label className="flex items-center gap-1.5 cursor-pointer" title={t('export.ignoreTimeFilterTooltip')}>
                    <input
                      type="checkbox"
                      checked={exportIgnoresTimeFilter}
                      onChange={e => setExportIgnoresTimeFilter(e.target.checked)}
                      className="input-check"
                    />
                    <span className="text-xs text-surface-500 dark:text-surface-400 underline decoration-dotted decoration-surface-400">{t('export.ignoreTimeFilter')}</span>
                  </label>
                )}
                <div className="flex gap-2">
                  <button onClick={() => handleExport('csv')} className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-md">CSV</button>
                  <button onClick={() => handleExport('json')} className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-md">JSON</button>
                  <button onClick={() => handleExport('txt')} className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-md">TXT</button>
                  <button
                    onClick={() => handleExport('parquet')}
                    data-testid="export-diagnostics-parquet"
                    className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-md"
                  >
                    Parquet
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SQL Console (LLM feature, opt-in) */}
        {SqlConsole && loadCompleted && (messages.length > 0 || diagnostics.length > 0) && (
          <div className="mb-6 animate-fade-in stagger-3">
            <Suspense fallback={
              <div className="border border-gray-300 rounded-lg p-4 bg-white">
                <div className="text-gray-600">{t('sql.loading')}</div>
              </div>
            }>
              <SqlConsole
                messages={messages}
                diagnostics={diagnostics}
                timezone={timezone}
                t={t}
              />
            </Suspense>
          </div>
        )}

        {/* Diagnostics Table */}
        {activeTab === 'diagnostics' && filteredDiagnostics.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                {t('table.diagnosticsTitle')} <span className="ml-2 text-xs font-mono text-surface-400">{filteredDiagnostics.length.toLocaleString()}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <div className="flex items-center gap-1 bg-surface-100/60 dark:bg-surface-800/40 rounded-md p-0.5">
                  <span className="text-xs text-surface-400 px-1.5">{t('table.show')}</span>
                  {[100, 500, 1000, 5000, 10000].map(n => (
                    <button key={n} onClick={() => setPreviewLimit(n)} className={`btn-chip min-w-[2.5rem] px-1.5 py-0.5 text-xs font-mono rounded text-center ${previewLimit === n ? 'bg-brand-600 text-white shadow-sm' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:bg-surface-200/60 dark:hover:bg-surface-700/40'}`}>{n.toLocaleString()}</button>
                  ))}
                </div>
                <button onClick={() => setTimezone(timezone === 'local' ? 'utc' : 'local')} className="btn-chip px-2.5 py-0.5 text-xs font-mono rounded bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
                  {timezone === 'local' ? t('table.timezone.local') : t('table.timezone.utc')}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-100/50 dark:bg-surface-800/50">
                    <th className="w-12 px-3 py-2.5">
                      <span className="sr-only">{t('table.details')}</span>
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">{t('table.time')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">{t('table.name')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">{t('table.level')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">{t('table.message')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-800/50">
                  {filteredDiagnostics.slice(0, previewLimit).map((diag, idx) => (
                    <Fragment key={idx}>
                      <tr className={`${DIAGNOSTIC_LEVEL_BG_COLORS[diag.level] || ''} hover:bg-surface-100/50 dark:hover:bg-surface-800/30 transition-colors`}>
                        <td className="px-3 py-2 align-top">
                          {diag.values.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleDiagRow(idx)}
                              aria-expanded={expandedDiagRows.has(idx)}
                              aria-controls={`diag-details-${idx}`}
                              aria-label={
                                expandedDiagRows.has(idx)
                                  ? tf('table.collapseDetails', { name: diag.name })
                                  : tf('table.expandDetails', { name: diag.name })
                              }
                              className="inline-flex h-6 w-6 items-center justify-center rounded border border-surface-200 bg-white text-surface-500 transition-colors hover:border-brand-300 hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-400 dark:hover:border-brand-500 dark:hover:text-brand-400"
                            >
                              {expandedDiagRows.has(idx) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            </button>
                          ) : (
                            <span aria-hidden="true" className="inline-block h-6 w-6" />
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-surface-700 dark:text-surface-300 whitespace-nowrap font-mono">{formatTime(diag.timestamp)}</td>
                        <td className="px-4 py-2 text-xs text-surface-600 dark:text-surface-400 font-mono">{diag.name}</td>
                        <td className={`px-4 py-2 text-xs font-medium whitespace-nowrap ${DIAGNOSTIC_LEVEL_COLORS[diag.level] || ''}`}>{DIAGNOSTIC_LEVEL_NAMES[diag.level] || String(diag.level)}</td>
                        <td className="px-4 py-2 text-xs text-surface-800 dark:text-surface-200">
                          {diag.message}
                          {diag.values.length > 0 && (
                            <span className="ml-2 text-xs text-surface-400 inline-flex items-center gap-1">
                              {tf('table.valuesCount', { count: diag.values.length })}
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedDiagRows.has(idx) && diag.values.length > 0 && (
                        <tr key={`${idx}-values`} id={`diag-details-${idx}`} className="bg-surface-50 dark:bg-surface-800/30">
                          <td colSpan={5} className="px-8 py-2">
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs font-mono">
                              {diag.values.map((v, vi) => (
                                <div key={vi} className={`flex gap-1 min-w-0 ${v.key.length + v.value.length > 40 ? 'col-span-full' : ''}`} data-testid="diag-detail-kv">
                                  <span className="text-surface-500 shrink-0">{v.key}:</span>
                                  <span className="text-surface-800 dark:text-surface-200 min-w-0 break-words">{v.value}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredDiagnostics.length > previewLimit && (
              <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-800 text-center text-xs text-surface-400">
                {tf('table.preview.stateChanges', {
                  shownCount: previewLimit,
                  totalCount: filteredDiagnostics.length.toLocaleString(),
                })}
              </div>
            )}
          </div>
        )}

        {/* Empty state for diagnostics */}
        {activeTab === 'diagnostics' && diagnostics.length > 0 && filteredDiagnostics.length === 0 && (
          <div className="text-center py-12">
            <p className="text-surface-400 dark:text-surface-500 text-sm">{t('empty.diagnostics')}</p>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pb-8 text-center border-t border-surface-200 dark:border-surface-800 pt-6">
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-2">
            {t('footer.offline')}
          </p>
          <a
            href="https://github.com/Tiryoh/rosbag-analyzer-web"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-chip rounded inline-flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
          >
            <Github className="w-3.5 h-3.5" />
            {t('footer.source')}
          </a>
        </footer>
      </div>
    </div>
  );
}

export default App;
