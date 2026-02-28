import { useState, Fragment } from 'react';
import { Upload, Filter, Download, BarChart3 } from 'lucide-react';
import type { RosoutMessage, DiagnosticStatusEntry } from './types';
import { SEVERITY_NAMES, SEVERITY_COLORS, SEVERITY_BG_COLORS, DIAGNOSTIC_LEVEL_NAMES, DIAGNOSTIC_LEVEL_COLORS, DIAGNOSTIC_LEVEL_BG_COLORS } from './types';
import {
  loadRosbagMessages,
  filterMessages,
  exportToCSV,
  exportToJSON,
  exportToTXT,
  exportDiagnosticsToCSV,
  exportDiagnosticsToJSON,
  exportDiagnosticsToTXT,
  downloadFile,
} from './rosbagUtils';

function App() {
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

  const handleExport = (format: 'csv' | 'json' | 'txt') => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    let content: string;
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
      }
    }

    downloadFile(content, filename, type);
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
    const filtered = diagnostics.filter(d => {
      const conditions: boolean[] = [];

      if (diagSelectedLevels.size > 0) {
        conditions.push(diagSelectedLevels.has(d.level));
      }
      if (diagSelectedNames.size > 0) {
        conditions.push(diagSelectedNames.has(d.name));
      }
      if (diagUseRegex && diagRegexPattern.trim()) {
        try {
          const regex = new RegExp(diagRegexPattern, 'i');
          conditions.push(regex.test(d.message));
        } catch { /* skip invalid regex */ }
      } else if (!diagUseRegex && diagKeywords) {
        const keywords = diagKeywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
        if (keywords.length > 0) {
          const msgLower = d.message.toLowerCase();
          conditions.push(keywords.some(kw => msgLower.includes(kw)));
        }
      }

      if (conditions.length === 0) return true;
      return diagFilterMode === 'AND' ? conditions.every(c => c) : conditions.some(c => c);
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-800 dark:text-white mb-2">
            🎯 ROSbag Analyzer
          </h1>
            <p className="text-gray-600 dark:text-gray-300">
            Browser-based tool for analyzing rosout/rosout_agg and diagnostics/diagnostics_agg - No installation required!<br />
            <span className="text-green-700 dark:text-green-400 font-semibold">
              All processing is done locally in your browser, no data is sent externally.
            </span>
            </p>
        </div>

        {/* File Upload */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-10 h-10 mb-3 text-gray-400" />
              <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                <span className="font-semibold">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">ROSbag file (.bag)</p>
            </div>
            <input
              type="file"
              className="hidden"
              accept=".bag"
              onChange={handleFileUpload}
              disabled={loading}
            />
          </label>

          {loading && (
            <div className="mt-4 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <p className="mt-2 text-gray-600 dark:text-gray-300">Loading bag file...</p>
            </div>
          )}

          {error && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-600 dark:text-red-400 font-semibold mb-2">Error loading bag file:</p>
              <pre className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap overflow-x-auto">{error}</pre>
            </div>
          )}

          {(messages.length > 0 || diagnostics.length > 0) && (
            <div className="mt-4 text-center">
              <p className="text-green-600 dark:text-green-400 font-semibold">
                ✓ Loaded {messages.length.toLocaleString()} rosout messages from {uniqueNodes.size} nodes
                {hasDiagnostics && `, ${diagnostics.length.toLocaleString()} diagnostics state changes`}
              </p>
            </div>
          )}
        </div>

        {/* Tabs */}
        {hasDiagnostics && (messages.length > 0 || diagnostics.length > 0) && (
          <div className="flex mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <button
              onClick={() => setActiveTab('rosout')}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'rosout'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Rosout ({filteredMessages.length.toLocaleString()})
            </button>
            <button
              onClick={() => setActiveTab('diagnostics')}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'diagnostics'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Diagnostics ({filteredDiagnostics.length.toLocaleString()})
            </button>
          </div>
        )}

        {/* Filters (rosout tab only) */}
        {activeTab === 'rosout' && messages.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
            <div className="flex items-center mb-4">
              <Filter className="w-5 h-5 mr-2 text-blue-500" />
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Filters</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Filter Mode */}
              <div className="text-left">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Filter Mode
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={filterMode === 'OR'}
                      onChange={() => setFilterMode('OR')}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      OR (Any match)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={filterMode === 'AND'}
                      onChange={() => setFilterMode('AND')}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      AND (All match)
                    </span>
                  </label>
                </div>
              </div>

              {/* Severity Levels */}
              <div className="text-left">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Severity Levels
                </label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(SEVERITY_NAMES).map(([level, name]) => (
                    <button
                      key={level}
                      onClick={() => toggleSeverity(Number(level))}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        selectedSeverities.has(Number(level))
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Nodes ({uniqueNodes.size})
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedNodes(new Set(uniqueNodes))}
                      className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                    >
                      select all
                    </button>
                    <button
                      onClick={() => setSelectedNodes(new Set())}
                      className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                    >
                      clear
                    </button>
                  </div>
                </div>
                <div className="max-h-32 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-md p-2">
                  {Array.from(uniqueNodes)
                    .sort()
                    .map(node => (
                      <label key={node} className="flex items-center py-1">
                        <input
                          type="checkbox"
                          checked={selectedNodes.has(node)}
                          onChange={() => toggleNode(node)}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{node}</span>
                      </label>
                    ))}
                </div>
              </div>

              {/* Message Filter Type */}
              <div className="text-left">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Message Filter Type
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={!useRegex}
                      onChange={() => setUseRegex(false)}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Keywords</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={useRegex}
                      onChange={() => setUseRegex(true)}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Regex</span>
                  </label>
                </div>
              </div>

              {/* Keywords or Regex */}
              <div className="md:col-span-2 text-left">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {useRegex ? 'Regular Expression Pattern' : 'Keywords (comma-separated)'}
                </label>
                <input
                  type="text"
                  value={useRegex ? regexPattern : keywords}
                  onChange={e => (useRegex ? setRegexPattern(e.target.value) : setKeywords(e.target.value))}
                  placeholder={
                    useRegex ? 'e.g., error.*timeout|connection.*failed' : 'e.g., error, timeout, connection'
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-4">
              <button
                onClick={applyFilters}
                className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md font-medium transition-colors"
              >
                Apply Filters
              </button>
              <button
                onClick={() => {
                  setSelectedNodes(new Set());
                  setSelectedSeverities(new Set());
                  setKeywords('');
                  setRegexPattern('');
                  setFilteredMessages(messages);
                }}
                className="px-6 py-2 bg-gray-300 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-md font-medium transition-colors"
              >
                Clear Filters
              </button>
              <button
                onClick={() => setShowStats(!showStats)}
                className="px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-md font-medium transition-colors flex items-center gap-2"
              >
                <BarChart3 className="w-4 h-4" />
                {showStats ? 'Hide Stats' : 'Show Stats'}
              </button>
            </div>
          </div>
        )}

        {/* Statistics (rosout tab only) */}
        {activeTab === 'rosout' && showStats && filteredMessages.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Statistics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  By Severity
                </h3>
                {Object.entries(stats.severityCount).map(([level, count]) => {
                  const percentage = ((count / filteredMessages.length) * 100).toFixed(1);
                  return (
                    <div key={level} className="flex justify-between items-center py-1">
                      <span className={`font-medium ${SEVERITY_COLORS[Number(level)]}`}>
                        {SEVERITY_NAMES[Number(level)]}
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {count} ({percentage}%)
                      </span>
                    </div>
                  );
                })}
              </div>
              <div>
                <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Top 5 Nodes
                </h3>
                {stats.topNodes.map(([node, count]) => {
                  const percentage = ((count / filteredMessages.length) * 100).toFixed(1);
                  return (
                    <div key={node} className="flex justify-between items-center py-1">
                      <span className="text-gray-700 dark:text-gray-300 truncate flex-1">
                        {node}
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 ml-2">
                        {count} ({percentage}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Export (rosout) */}
        {activeTab === 'rosout' && filteredMessages.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white">Export</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {filteredMessages.length.toLocaleString()} messages ready to export
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleExport('csv')}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md font-medium transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  CSV
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md font-medium transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  JSON
                </button>
                <button
                  onClick={() => handleExport('txt')}
                  className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-md font-medium transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  TXT
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages Table (rosout) */}
        {activeTab === 'rosout' && filteredMessages.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                Messages ({filteredMessages.length.toLocaleString()})
              </h2>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Show:</span>
                  {[100, 500, 1000].map(n => (
                    <button
                      key={n}
                      onClick={() => setPreviewLimit(n)}
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                        previewLimit === n
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Timezone:</span>
                <button
                  onClick={() => setTimezone(timezone === 'local' ? 'utc' : 'local')}
                  className="px-3 py-1 text-sm font-medium rounded-md transition-colors bg-blue-500 hover:bg-blue-600 text-white"
                >
                  {timezone === 'local' ? 'Local' : 'UTC'}
                </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Node
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Level
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Message
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredMessages.slice(0, previewLimit).map((msg, idx) => {
                    return (
                      <tr key={idx} className={SEVERITY_BG_COLORS[msg.severity]}>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                          {formatTime(msg.timestamp)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {msg.node}
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${SEVERITY_COLORS[msg.severity]}`}>
                          {SEVERITY_NAMES[msg.severity]}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                          {msg.message}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredMessages.length > previewLimit && (
              <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 text-center text-sm text-gray-500 dark:text-gray-400">
                Showing first {previewLimit} of {filteredMessages.length.toLocaleString()} messages
              </div>
            )}
          </div>
        )}

        {/* Diagnostics Filters */}
        {activeTab === 'diagnostics' && diagnostics.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
            <div className="flex items-center mb-4">
              <Filter className="w-5 h-5 mr-2 text-blue-500" />
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Filters</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Filter Mode */}
              <div className="text-left">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Filter Mode
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input type="radio" checked={diagFilterMode === 'OR'} onChange={() => setDiagFilterMode('OR')} className="mr-2" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">OR (Any match)</span>
                  </label>
                  <label className="flex items-center">
                    <input type="radio" checked={diagFilterMode === 'AND'} onChange={() => setDiagFilterMode('AND')} className="mr-2" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">AND (All match)</span>
                  </label>
                </div>
              </div>

              {/* Diagnostic Levels */}
              <div className="text-left">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Levels
                </label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(DIAGNOSTIC_LEVEL_NAMES).map(([level, name]) => (
                    <button
                      key={level}
                      onClick={() => toggleDiagLevel(Number(level))}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        diagSelectedLevels.has(Number(level))
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Names */}
              <div className="text-left">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Names ({uniqueDiagNames.size})
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDiagSelectedNames(new Set(uniqueDiagNames))}
                      className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                    >
                      select all
                    </button>
                    <button
                      onClick={() => setDiagSelectedNames(new Set())}
                      className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                    >
                      clear
                    </button>
                  </div>
                </div>
                <div className="max-h-32 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-md p-2">
                  {Array.from(uniqueDiagNames).sort().map(name => (
                    <label key={name} className="flex items-center py-1">
                      <input type="checkbox" checked={diagSelectedNames.has(name)} onChange={() => toggleDiagName(name)} className="mr-2" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Message Filter Type */}
              <div className="text-left">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Message Filter Type
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input type="radio" checked={!diagUseRegex} onChange={() => setDiagUseRegex(false)} className="mr-2" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Keywords</span>
                  </label>
                  <label className="flex items-center">
                    <input type="radio" checked={diagUseRegex} onChange={() => setDiagUseRegex(true)} className="mr-2" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Regex</span>
                  </label>
                </div>
              </div>

              {/* Keywords or Regex */}
              <div className="md:col-span-2 text-left">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {diagUseRegex ? 'Regular Expression Pattern' : 'Keywords (comma-separated)'}
                </label>
                <input
                  type="text"
                  value={diagUseRegex ? diagRegexPattern : diagKeywords}
                  onChange={e => (diagUseRegex ? setDiagRegexPattern(e.target.value) : setDiagKeywords(e.target.value))}
                  placeholder={diagUseRegex ? 'e.g., error.*timeout|connection.*failed' : 'e.g., error, timeout, connection'}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-4">
              <button
                onClick={applyDiagFilters}
                className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md font-medium transition-colors"
              >
                Apply Filters
              </button>
              <button
                onClick={() => {
                  setDiagSelectedNames(new Set());
                  setDiagSelectedLevels(new Set());
                  setDiagKeywords('');
                  setDiagRegexPattern('');
                  setFilteredDiagnostics(diagnostics);
                  setExpandedDiagRows(new Set());
                }}
                className="px-6 py-2 bg-gray-300 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-md font-medium transition-colors"
              >
                Clear Filters
              </button>
            </div>
          </div>
        )}

        {/* Export (diagnostics) */}
        {activeTab === 'diagnostics' && filteredDiagnostics.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white">Export</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {filteredDiagnostics.length.toLocaleString()} diagnostics state changes ready to export
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleExport('csv')}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md font-medium transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  CSV
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md font-medium transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  JSON
                </button>
                <button
                  onClick={() => handleExport('txt')}
                  className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-md font-medium transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  TXT
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Diagnostics Table */}
        {activeTab === 'diagnostics' && filteredDiagnostics.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                Diagnostics State Changes ({filteredDiagnostics.length.toLocaleString()})
              </h2>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Show:</span>
                  {[100, 500, 1000].map(n => (
                    <button
                      key={n}
                      onClick={() => setPreviewLimit(n)}
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                        previewLimit === n
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Timezone:</span>
                  <button
                    onClick={() => setTimezone(timezone === 'local' ? 'utc' : 'local')}
                    className="px-3 py-1 text-sm font-medium rounded-md transition-colors bg-blue-500 hover:bg-blue-600 text-white"
                  >
                    {timezone === 'local' ? 'Local' : 'UTC'}
                  </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Level
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Message
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredDiagnostics.slice(0, previewLimit).map((diag, idx) => (
                    <Fragment key={idx}>
                      <tr
                        className={`${DIAGNOSTIC_LEVEL_BG_COLORS[diag.level] || ''} cursor-pointer hover:opacity-80`}
                        onClick={() => toggleDiagRow(idx)}
                      >
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                          {formatTime(diag.timestamp)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                          {diag.name}
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${DIAGNOSTIC_LEVEL_COLORS[diag.level] || ''}`}>
                          {DIAGNOSTIC_LEVEL_NAMES[diag.level] || String(diag.level)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                          {diag.message}
                          {diag.values.length > 0 && (
                            <span className="ml-2 text-xs text-gray-400">
                              {expandedDiagRows.has(idx) ? '▼' : '▶'} {diag.values.length} values
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedDiagRows.has(idx) && diag.values.length > 0 && (
                        <tr key={`${idx}-values`} className="bg-gray-50 dark:bg-gray-900">
                          <td colSpan={4} className="px-8 py-2">
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                              {diag.values.map((v, vi) => (
                                <div key={vi} className="flex gap-1">
                                  <span className="font-medium text-gray-600 dark:text-gray-400">{v.key}:</span>
                                  <span className="text-gray-800 dark:text-gray-200">{v.value}</span>
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
              <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 text-center text-sm text-gray-500 dark:text-gray-400">
                Showing first {previewLimit} of {filteredDiagnostics.length.toLocaleString()} state changes
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
