import { useRef, useState, Fragment } from 'react';
import { Upload, Filter, Download, BarChart3, Github, ChevronDown, ChevronRight } from 'lucide-react';
import type { RosoutMessage, DiagnosticStatusEntry } from './types';
import { SEVERITY_NAMES, SEVERITY_COLORS, SEVERITY_BG_COLORS, DIAGNOSTIC_LEVEL_NAMES, DIAGNOSTIC_LEVEL_COLORS, DIAGNOSTIC_LEVEL_BG_COLORS } from './types';
import {
  loadRosbagMessages,
  filterMessages,
  exportToCSV,
  exportToJSON,
  exportToTXT,
  exportToSQLite,
  exportDiagnosticsToCSV,
  exportDiagnosticsToJSON,
  exportDiagnosticsToTXT,
  exportDiagnosticsToSQLite,
  downloadFile,
  filterDiagnostics,
} from './rosbagUtils';
import { useI18n } from './i18n';

function App() {
  const { lang, setLang, t, tf } = useI18n();
  const [messages, setMessages] = useState<RosoutMessage[]>([]);
  const [filteredMessages, setFilteredMessages] = useState<RosoutMessage[]>([]);
  const [uniqueNodes, setUniqueNodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Filter states
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedSeverities, setSelectedSeverities] = useState<Set<number>>(new Set());
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

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('=== File upload started ===');
    console.log('Selected file:', file.name);

    setLoading(true);
    setError('');

    try {
      console.log('Calling loadRosbagMessages...');
      const result = await loadRosbagMessages(file);
      console.log('loadRosbagMessages completed successfully');
      console.log('Messages loaded:', result.messages.length);
      console.log('Unique nodes:', result.uniqueNodes.size);
      console.log('Diagnostics:', result.diagnostics.length, 'hasDiagnostics:', result.hasDiagnostics);

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
      setActiveTab(result.messages.length > 0 ? 'rosout' : 'diagnostics');
      console.log('State updated successfully');
    } catch (err) {
      console.error('Error in handleFileUpload:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load bag file';
      setError(errorMessage);
    } finally {
      setLoading(false);
      console.log('=== File upload completed ===');
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
    });
    setFilteredMessages(filtered);
  };

  const handleExport = async (format: 'csv' | 'json' | 'txt' | 'sqlite') => {
    try {
      setError('');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      let content: string | Uint8Array;
      let filename: string;
      let type: string;

      if (activeTab === 'diagnostics') {
        const prefix = 'diagnostics_export';
        switch (format) {
          case 'csv':
            content = exportDiagnosticsToCSV(filteredDiagnostics, timezone);
            filename = `${prefix}_${timestamp}.csv`;
            type = 'text/csv';
            break;
          case 'json':
            content = exportDiagnosticsToJSON(filteredDiagnostics, timezone);
            filename = `${prefix}_${timestamp}.json`;
            type = 'application/json';
            break;
          case 'txt':
            content = exportDiagnosticsToTXT(filteredDiagnostics, timezone);
            filename = `${prefix}_${timestamp}.txt`;
            type = 'text/plain';
            break;
          case 'sqlite':
            content = await exportDiagnosticsToSQLite(filteredDiagnostics, timezone);
            filename = `${prefix}_${timestamp}.sqlite`;
            type = 'application/vnd.sqlite3';
            break;
          default: {
            const exhaustiveFormat: never = format;
            throw new Error(`Unsupported export format: ${exhaustiveFormat}`);
          }
        }
      } else {
        switch (format) {
          case 'csv':
            content = exportToCSV(filteredMessages, timezone);
            filename = `rosout_export_${timestamp}.csv`;
            type = 'text/csv';
            break;
          case 'json':
            content = exportToJSON(filteredMessages, timezone);
            filename = `rosout_export_${timestamp}.json`;
            type = 'application/json';
            break;
          case 'txt':
            content = exportToTXT(filteredMessages, timezone);
            filename = `rosout_export_${timestamp}.txt`;
            type = 'text/plain';
            break;
          case 'sqlite':
            content = await exportToSQLite(filteredMessages, timezone);
            filename = `rosout_export_${timestamp}.sqlite`;
            type = 'application/vnd.sqlite3';
            break;
          default: {
            const exhaustiveFormat: never = format;
            throw new Error(`Unsupported export format: ${exhaustiveFormat}`);
          }
        }
      }

      downloadFile(content, filename, type);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to export file';
      setError(errorMessage);
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

  const toggleSeverity = (severity: number) => {
    const newSet = new Set(selectedSeverities);
    if (newSet.has(severity)) {
      newSet.delete(severity);
    } else {
      newSet.add(severity);
    }
    setSelectedSeverities(newSet);
  };

  const getStatistics = () => {
    const severityCount: Record<number, number> = {};
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

  const hasData = messages.length > 0 || diagnostics.length > 0;

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 bg-grid">
      <div className="container mx-auto px-4 py-8 max-w-6xl">

        {/* Header */}
        <header className="mb-10 text-center animate-fade-in">
          <div className="flex justify-end mb-2">
            <div className="flex gap-0.5 p-0.5 bg-surface-200/60 dark:bg-surface-800/60 rounded-md">
              <button
                onClick={() => setLang('ja')}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-all ${
                  lang === 'ja'
                    ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
              >
                JA
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-all ${
                  lang === 'en'
                    ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
              >
                EN
              </button>
            </div>
          </div>
          <img src="/logo.png" alt="ROSbag Analyzer" className="mx-auto h-28 sm:h-36 mb-3" />
          <h1 className="sr-only">ROSbag Analyzer</h1>
          <p className="text-surface-600 dark:text-surface-300 text-sm mx-auto leading-relaxed">
            {t('header.description')}
          </p>
          <p className="mt-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400 tracking-wide">
            {t('header.privacy')}
          </p>
        </header>

        {/* File Upload */}
        <div className="animate-fade-in stagger-1 mb-8">
          <div
            className={`drop-zone flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl ${
              isDragging
                ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20'
                : 'border-surface-300 dark:border-surface-700 bg-white/60 dark:bg-surface-900/60 backdrop-blur-sm'
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
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-brand-600 text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-surface-900 disabled:cursor-not-allowed disabled:opacity-60"
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
              accept=".bag"
              onChange={handleFileUpload}
              disabled={loading}
              data-testid="bag-upload-input"
            />
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="mb-8 animate-fade-in">
            <div className="h-1.5 w-full bg-surface-200 dark:bg-surface-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full loading-bar" />
            </div>
            <p className="mt-3 text-center text-sm text-surface-500 dark:text-surface-400">{t('loading.message')}</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded-xl animate-fade-in">
            <p className="text-red-700 dark:text-red-400 font-semibold text-sm mb-1">{t('error.title')}</p>
            <pre className="text-xs text-red-600 dark:text-red-300 whitespace-pre-wrap overflow-x-auto font-mono">{error}</pre>
          </div>
        )}

        {/* Success */}
        {hasData && !loading && (
          <div className="mb-8 text-center animate-fade-in">
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

        {/* Tabs */}
        {hasDiagnostics && hasData && (
          <div className="flex gap-1 mb-6 p-1 bg-surface-200/60 dark:bg-surface-800/60 rounded-lg w-fit mx-auto animate-fade-in">
            <button
              onClick={() => setActiveTab('rosout')}
              data-testid="rosout-tab"
              className={`px-5 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'rosout'
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
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
              className={`px-5 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'diagnostics'
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
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
          <div className="bg-white/70 dark:bg-surface-900/70 backdrop-blur-sm border border-surface-200 dark:border-surface-800 rounded-xl p-6 mb-6 animate-fade-in stagger-2">
            <div className="flex items-center mb-5">
              <Filter className="w-4 h-4 mr-2 text-brand-600 dark:text-brand-400" />
              <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-100">{t('filter.title')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Filter Mode */}
              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wider">
                  {t('filter.mode')}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={filterMode === 'OR'} onChange={() => setFilterMode('OR')} className="mr-2 accent-brand-600" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.mode.or')}</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={filterMode === 'AND'} onChange={() => setFilterMode('AND')} className="mr-2 accent-brand-600" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.mode.and')}</span>
                  </label>
                </div>
              </div>

              {/* Severity Levels */}
              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wider">
                  {t('filter.severity')}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(SEVERITY_NAMES).map(([level, name]) => (
                    <button
                      key={level}
                      onClick={() => toggleSeverity(Number(level))}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                        selectedSeverities.has(Number(level))
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nodes */}
              <div className="text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">
                    {t('filter.nodes')} ({uniqueNodes.size})
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedNodes(new Set(uniqueNodes))} className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300">
                      {t('filter.selectAll')}
                    </button>
                    <button onClick={() => setSelectedNodes(new Set())} className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300">
                      {t('filter.clear')}
                    </button>
                  </div>
                </div>
                <div className="max-h-32 overflow-y-auto border border-surface-200 dark:border-surface-700 rounded-lg p-2 bg-surface-50 dark:bg-surface-800/50">
                  {Array.from(uniqueNodes).sort().map(node => (
                    <label key={node} className="flex items-center py-1 cursor-pointer">
                      <input type="checkbox" checked={selectedNodes.has(node)} onChange={() => toggleNode(node)} className="mr-2 accent-brand-600" />
                      <span className="text-xs text-surface-700 dark:text-surface-300 font-mono">{node}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Message Filter Type */}
              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wider">
                  {t('filter.messageType')}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={!useRegex} onChange={() => setUseRegex(false)} className="mr-2 accent-brand-600" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.keywords')}</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={useRegex} onChange={() => setUseRegex(true)} className="mr-2 accent-brand-600" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.regex')}</span>
                  </label>
                </div>
              </div>

              {/* Keywords or Regex */}
              <div className="md:col-span-2 text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wider">
                  {useRegex ? t('filter.regexLabel') : t('filter.keywordsLabel')}
                </label>
                <input
                  type="text"
                  value={useRegex ? regexPattern : keywords}
                  onChange={e => (useRegex ? setRegexPattern(e.target.value) : setKeywords(e.target.value))}
                  placeholder={useRegex ? t('filter.regexPlaceholder') : t('filter.keywordsPlaceholder')}
                  className="w-full px-3 py-2 text-sm border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-800/50 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all font-mono"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={applyFilters} className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded-lg font-medium transition-colors shadow-sm">
                {t('filter.apply')}
              </button>
              <button
                onClick={() => { setSelectedNodes(new Set()); setSelectedSeverities(new Set()); setKeywords(''); setRegexPattern(''); setFilteredMessages(messages); }}
                className="px-5 py-2 bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300 text-sm rounded-lg font-medium transition-colors"
              >
                {t('filter.clearAll')}
              </button>
              <button
                onClick={() => setShowStats(!showStats)}
                className="px-5 py-2 bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300 text-sm rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                {showStats ? t('stats.hide') : t('stats.show')}
              </button>
            </div>
          </div>
        )}

        {/* Statistics (rosout tab only) */}
        {activeTab === 'rosout' && showStats && filteredMessages.length > 0 && (
          <div className="bg-white/70 dark:bg-surface-900/70 backdrop-blur-sm border border-surface-200 dark:border-surface-800 rounded-xl p-6 mb-6 animate-fade-in">
            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-100 mb-4">{t('stats.title')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-3 uppercase tracking-wider">{t('stats.bySeverity')}</h3>
                {Object.entries(stats.severityCount).map(([level, count]) => {
                  const percentage = ((count / filteredMessages.length) * 100).toFixed(1);
                  return (
                    <div key={level} className="flex justify-between items-center py-1.5">
                      <span className={`text-sm font-medium ${SEVERITY_COLORS[Number(level)]}`}>{SEVERITY_NAMES[Number(level)]}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${percentage}%` }} />
                        </div>
                        <span className="text-xs text-surface-500 dark:text-surface-400 font-mono w-20 text-right">{count} ({percentage}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <h3 className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-3 uppercase tracking-wider">{t('stats.topNodes')}</h3>
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
          <div className="bg-white/70 dark:bg-surface-900/70 backdrop-blur-sm border border-surface-200 dark:border-surface-800 rounded-xl p-5 mb-6 animate-fade-in stagger-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Download className="w-4 h-4 text-surface-400" />
                <div>
                  <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{t('export.title')}</span>
                  <span className="text-xs text-surface-400 ml-2">{filteredMessages.length.toLocaleString()} {t('export.messages')}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleExport('csv')} className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-md transition-colors">CSV</button>
                <button onClick={() => handleExport('json')} className="px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-md transition-colors">JSON</button>
                <button onClick={() => handleExport('txt')} className="px-3 py-1.5 text-xs font-medium bg-surface-600 hover:bg-surface-700 text-white rounded-md transition-colors">TXT</button>
                <button
                  onClick={() => handleExport('sqlite')}
                  data-testid="export-rosout-sqlite"
                  className="px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-800 text-white rounded-md transition-colors"
                >
                  SQLite
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages Table (rosout) */}
        {activeTab === 'rosout' && filteredMessages.length > 0 && (
          <div className="bg-white/70 dark:bg-surface-900/70 backdrop-blur-sm border border-surface-200 dark:border-surface-800 rounded-xl overflow-hidden animate-fade-in stagger-4">
            <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                {t('table.messages')} <span className="ml-2 text-xs font-mono text-surface-400">{filteredMessages.length.toLocaleString()}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-surface-400">{t('table.show')}</span>
                  {[100, 500, 1000].map(n => (
                    <button key={n} onClick={() => setPreviewLimit(n)} className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${previewLimit === n ? 'bg-brand-600 text-white' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'}`}>{n}</button>
                  ))}
                </div>
                <button onClick={() => setTimezone(timezone === 'local' ? 'utc' : 'local')} className="px-2.5 py-0.5 text-xs font-mono rounded bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors">
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
                      <td className={`px-4 py-2 text-xs font-medium whitespace-nowrap ${SEVERITY_COLORS[msg.severity]}`}>{SEVERITY_NAMES[msg.severity]}</td>
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
          <div className="text-center py-12 animate-fade-in">
            <p className="text-surface-400 dark:text-surface-500 text-sm">{t('empty.rosout')}</p>
          </div>
        )}

        {/* Diagnostics Filters */}
        {activeTab === 'diagnostics' && diagnostics.length > 0 && (
          <div className="bg-white/70 dark:bg-surface-900/70 backdrop-blur-sm border border-surface-200 dark:border-surface-800 rounded-xl p-6 mb-6 animate-fade-in stagger-2">
            <div className="flex items-center mb-5">
              <Filter className="w-4 h-4 mr-2 text-brand-600 dark:text-brand-400" />
              <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-100">{t('filter.title')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wider">{t('filter.mode')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={diagFilterMode === 'OR'} onChange={() => setDiagFilterMode('OR')} className="mr-2 accent-brand-600" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.mode.or')}</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={diagFilterMode === 'AND'} onChange={() => setDiagFilterMode('AND')} className="mr-2 accent-brand-600" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.mode.and')}</span>
                  </label>
                </div>
              </div>

              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wider">{t('filter.levels')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(DIAGNOSTIC_LEVEL_NAMES).map(([level, name]) => (
                    <button key={level} onClick={() => toggleDiagLevel(Number(level))} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${diagSelectedLevels.has(Number(level)) ? 'bg-brand-600 text-white shadow-sm' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'}`}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">{t('filter.names')} ({uniqueDiagNames.size})</label>
                  <div className="flex gap-2">
                    <button onClick={() => setDiagSelectedNames(new Set(uniqueDiagNames))} className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300">{t('filter.selectAll')}</button>
                    <button onClick={() => setDiagSelectedNames(new Set())} className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300">{t('filter.clear')}</button>
                  </div>
                </div>
                <div className="max-h-32 overflow-y-auto border border-surface-200 dark:border-surface-700 rounded-lg p-2 bg-surface-50 dark:bg-surface-800/50">
                  {Array.from(uniqueDiagNames).sort().map(name => (
                    <label key={name} className="flex items-center py-1 cursor-pointer">
                      <input type="checkbox" checked={diagSelectedNames.has(name)} onChange={() => toggleDiagName(name)} className="mr-2 accent-brand-600" />
                      <span className="text-xs text-surface-700 dark:text-surface-300 font-mono">{name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wider">{t('filter.messageType')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={!diagUseRegex} onChange={() => setDiagUseRegex(false)} className="mr-2 accent-brand-600" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.keywords')}</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input type="radio" checked={diagUseRegex} onChange={() => setDiagUseRegex(true)} className="mr-2 accent-brand-600" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">{t('filter.regex')}</span>
                  </label>
                </div>
              </div>

              <div className="md:col-span-2 text-left">
                <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 uppercase tracking-wider">
                  {diagUseRegex ? t('filter.regexLabel') : t('filter.keywordsLabel')}
                </label>
                <input
                  type="text"
                  value={diagUseRegex ? diagRegexPattern : diagKeywords}
                  onChange={e => (diagUseRegex ? setDiagRegexPattern(e.target.value) : setDiagKeywords(e.target.value))}
                  placeholder={diagUseRegex ? t('filter.regexPlaceholder') : t('filter.keywordsPlaceholder')}
                  className="w-full px-3 py-2 text-sm border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-800/50 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all font-mono"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={applyDiagFilters} className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded-lg font-medium transition-colors shadow-sm">{t('filter.apply')}</button>
              <button
                onClick={() => { setDiagSelectedNames(new Set()); setDiagSelectedLevels(new Set()); setDiagKeywords(''); setDiagRegexPattern(''); setFilteredDiagnostics(diagnostics); setExpandedDiagRows(new Set()); }}
                className="px-5 py-2 bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300 text-sm rounded-lg font-medium transition-colors"
              >
                {t('filter.clearAll')}
              </button>
            </div>
          </div>
        )}

        {/* Export (diagnostics) */}
        {activeTab === 'diagnostics' && filteredDiagnostics.length > 0 && (
          <div className="bg-white/70 dark:bg-surface-900/70 backdrop-blur-sm border border-surface-200 dark:border-surface-800 rounded-xl p-5 mb-6 animate-fade-in stagger-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Download className="w-4 h-4 text-surface-400" />
                <div>
                  <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{t('export.title')}</span>
                  <span className="text-xs text-surface-400 ml-2">{filteredDiagnostics.length.toLocaleString()} {t('export.stateChanges')}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleExport('csv')} className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-md transition-colors">CSV</button>
                <button onClick={() => handleExport('json')} className="px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-md transition-colors">JSON</button>
                <button onClick={() => handleExport('txt')} className="px-3 py-1.5 text-xs font-medium bg-surface-600 hover:bg-surface-700 text-white rounded-md transition-colors">TXT</button>
                <button
                  onClick={() => handleExport('sqlite')}
                  data-testid="export-diagnostics-sqlite"
                  className="px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-800 text-white rounded-md transition-colors"
                >
                  SQLite
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Diagnostics Table */}
        {activeTab === 'diagnostics' && filteredDiagnostics.length > 0 && (
          <div className="bg-white/70 dark:bg-surface-900/70 backdrop-blur-sm border border-surface-200 dark:border-surface-800 rounded-xl overflow-hidden animate-fade-in stagger-4">
            <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                {t('table.diagnosticsTitle')} <span className="ml-2 text-xs font-mono text-surface-400">{filteredDiagnostics.length.toLocaleString()}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-surface-400">{t('table.show')}</span>
                  {[100, 500, 1000].map(n => (
                    <button key={n} onClick={() => setPreviewLimit(n)} className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${previewLimit === n ? 'bg-brand-600 text-white' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'}`}>{n}</button>
                  ))}
                </div>
                <button onClick={() => setTimezone(timezone === 'local' ? 'utc' : 'local')} className="px-2.5 py-0.5 text-xs font-mono rounded bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors">
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
                                <div key={vi} className="flex gap-1">
                                  <span className="text-surface-500">{v.key}:</span>
                                  <span className="text-surface-800 dark:text-surface-200">{v.value}</span>
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
          <div className="text-center py-12 animate-fade-in">
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
            className="inline-flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
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
