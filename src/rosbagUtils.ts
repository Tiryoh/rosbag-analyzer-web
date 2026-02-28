import Bag from '@foxglove/rosbag/dist/cjs/Bag';
import BlobReader from '@foxglove/rosbag/dist/cjs/web/BlobReader';
import type { RosoutMessage, DiagnosticStatusEntry } from './types';
import { DIAGNOSTIC_LEVEL_NAMES } from './types';

export async function loadRosbagMessages(file: File): Promise<{
  messages: RosoutMessage[];
  uniqueNodes: Set<string>;
  diagnostics: DiagnosticStatusEntry[];
  hasDiagnostics: boolean;
}> {
  const messages: RosoutMessage[] = [];
  const uniqueNodes = new Set<string>();

  console.log('=== Starting ROSbag load ===');
  console.log('File name:', file.name);
  console.log('File size:', file.size, 'bytes');
  console.log('File type:', file.type);

  try {
    console.log('Reading file as ArrayBuffer...');
    const arrayBuffer = await file.arrayBuffer();
    console.log('ArrayBuffer loaded, size:', arrayBuffer.byteLength);

    // Check bag file header
    const headerView = new Uint8Array(arrayBuffer, 0, Math.min(100, arrayBuffer.byteLength));
    const headerStr = new TextDecoder().decode(headerView.slice(0, 13));
    console.log('Bag file header:', headerStr);
    console.log('First 20 bytes:', Array.from(headerView.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));

    console.log('Creating BlobReader...');
    const reader = new BlobReader(new Blob([arrayBuffer]));

    // Dynamically import decompression libraries
    console.log('Loading decompression libraries...');
    const { decompress: bzip2Decompress } = await import('seek-bzip');
    const lz4Module = await import('lz4js');
    const lz4 = lz4Module.default || lz4Module;

    console.log('Creating Bag with decompression support...');
    const bag = new Bag(reader, {
      decompress: {
        bz2: (buffer: Uint8Array) => {
          console.log('Decompressing bz2 chunk, size:', buffer.length);
          return bzip2Decompress(buffer);
        },
        lz4: (buffer: Uint8Array) => {
          console.log('Decompressing lz4 chunk, size:', buffer.length);
          return lz4.decompress(buffer);
        },
      },
    });

    console.log('Opening bag with BlobReader...');
    await bag.open();
    console.log('✓ Bag opened successfully');

    console.log('Bag header:', bag.header);
    console.log('Start time:', bag.startTime);
    console.log('End time:', bag.endTime);
    console.log('Connections count:', bag.connections.size);
    console.log('Chunk infos count:', bag.chunkInfos.length);

    // Check if bag is indexed
    if (bag.header && bag.header.indexPosition === 0 && bag.header.connectionCount === 0 && bag.header.chunkCount === 0) {
      throw new Error(
        '❌ このbagファイルはインデックス化されていないため、ブラウザ上で読み込めません。\n\n' +
        '🔧 解決方法:\n' +
        'ターミナルで以下のコマンドを実行してください:\n\n' +
        `  rosbag reindex ${file.name}\n\n` +
        'これによりインデックス付きバージョンが作成され、ブラウザで解析できるようになります。\n\n' +
        '💡 ヒント: reindexされたファイルは元のファイル名に ".orig" が追加されます。'
      );
    }

    // Find rosout and diagnostics topics
    console.log('Searching for rosout and diagnostics topics...');
    const rosoutTopics: string[] = [];
    const diagnosticsTopics: string[] = [];
    for (const [connId, conn] of bag.connections) {
      console.log(`  Connection ${connId}: Topic: ${conn.topic}, Type: ${conn.type}`);
      if (conn.topic.includes('rosout') || conn.type === 'rosgraph_msgs/Log') {
        rosoutTopics.push(conn.topic);
        console.log(`    ✓ Found rosout topic: ${conn.topic}`);
      }
      if (conn.topic.includes('diagnostics') || conn.type === 'diagnostic_msgs/DiagnosticArray') {
        diagnosticsTopics.push(conn.topic);
        console.log(`    ✓ Found diagnostics topic: ${conn.topic}`);
      }
    }

    console.log('Total rosout topics found:', rosoutTopics.length);
    console.log('Total diagnostics topics found:', diagnosticsTopics.length);

    if (rosoutTopics.length === 0 && diagnosticsTopics.length === 0) {
      const availableTopics = Array.from(bag.connections.values())
        .map((conn: any) => `  - ${conn.topic} [${conn.type}]`)
        .join('\n');

      throw new Error(
        `No rosout or diagnostics topics found in bag file.\n\nAvailable topics:\n${availableTopics}\n\n` +
        `Looking for topics containing 'rosout' or 'diagnostics' (e.g. '/diagnostics' or '/diagnostics_agg') or of type 'diagnostic_msgs/DiagnosticArray'`
      );
    }

    const decompressOptions = {
      bz2: (buffer: Uint8Array) => bzip2Decompress(buffer),
      lz4: (buffer: Uint8Array) => lz4.decompress(buffer),
    };

    // Read rosout messages
    if (rosoutTopics.length > 0) {
      console.log('Reading rosout messages from topics:', rosoutTopics);
      let messageCount = 0;

      await bag.readMessages(
        { topics: rosoutTopics, decompress: decompressOptions },
        (result: any) => {
          messageCount++;
          if (messageCount % 100 === 0) {
            console.log(`  Processing rosout message ${messageCount}...`);
          }

          const msg = result.message;

          if (msg && msg.level !== undefined && msg.msg !== undefined) {
            const rosoutMsg: RosoutMessage = {
              timestamp: result.timestamp.sec + result.timestamp.nsec / 1e9,
              node: msg.name || 'unknown',
              severity: msg.level,
              message: msg.msg,
              file: msg.file || '',
              line: msg.line || 0,
              function: msg.function || '',
              topics: msg.topics || [],
            };

            messages.push(rosoutMsg);
            if (msg.name) {
              uniqueNodes.add(msg.name);
            }
          }
        }
      );
      console.log(`✓ Successfully loaded ${messages.length} rosout messages from ${uniqueNodes.size} nodes`);
    }

    // Read diagnostics messages (state-change only)
    const diagnostics: DiagnosticStatusEntry[] = [];
    const hasDiagnostics = diagnosticsTopics.length > 0;

    if (hasDiagnostics) {
      console.log('Reading diagnostics messages from topics:', diagnosticsTopics);
      const lastState = new Map<string, { level: number; message: string }>();

      await bag.readMessages(
        { topics: diagnosticsTopics, decompress: decompressOptions },
        (result: any) => {
          const msg = result.message;
          if (!msg || !msg.status) return;

          const timestamp = result.timestamp.sec + result.timestamp.nsec / 1e9;

          for (const status of msg.status) {
            const name: string = status.name || 'unknown';
            const level: number = status.level ?? 0;
            const message: string = status.message || '';
            const values: { key: string; value: string }[] = (status.values || []).map((v: any) => ({
              key: v.key || '',
              value: v.value || '',
            }));

            const prev = lastState.get(name);
            if (!prev || prev.level !== level || prev.message !== message) {
              lastState.set(name, { level, message });
              diagnostics.push({ timestamp, name, level, message, values });
            }
          }
        }
      );
      console.log(`✓ Successfully loaded ${diagnostics.length} diagnostics state changes`);
    }

    return { messages, uniqueNodes, diagnostics, hasDiagnostics };
  } catch (error) {
    console.error('!!! Error loading rosbag !!!');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
}

export function filterMessages(
  messages: RosoutMessage[],
  filters: {
    nodeNames?: Set<string>;
    severityLevels?: Set<number>;
    messageKeywords?: string[];
    messageRegex?: string;
    filterMode?: 'OR' | 'AND';
    useRegex?: boolean;
    startTime?: number;
    endTime?: number;
  }
): RosoutMessage[] {
  return messages.filter((msg) => {
    const conditions: boolean[] = [];

    // Severity filter
    if (filters.severityLevels && filters.severityLevels.size > 0) {
      conditions.push(filters.severityLevels.has(msg.severity));
    }

    // Node filter
    if (filters.nodeNames && filters.nodeNames.size > 0) {
      conditions.push(filters.nodeNames.has(msg.node));
    }

    // Message text filter (keywords or regex)
    if (filters.useRegex && filters.messageRegex && filters.messageRegex.trim()) {
      try {
        const regex = new RegExp(filters.messageRegex, 'i');
        conditions.push(regex.test(msg.message));
      } catch (e) {
        // Invalid regex, skip this filter
        console.warn('Invalid regex pattern:', filters.messageRegex);
      }
    } else if (!filters.useRegex && filters.messageKeywords && filters.messageKeywords.length > 0) {
      // Normalize keywords: trim, drop empty entries (e.g. from trailing commas), and lowercase
      const keywords = filters.messageKeywords
        .map(k => (k ?? '').toString().trim())
        .filter(k => k.length > 0)
        .map(k => k.toLowerCase());

      // If all entries were empty (e.g. user typed "," or "error,"), skip this keyword filter
      if (keywords.length > 0) {
        const messageLower = msg.message.toLowerCase();
        const hasKeyword = keywords.some(keyword => messageLower.includes(keyword));
        conditions.push(hasKeyword);
      }
    }

    // Time range filters
    if (filters.startTime !== undefined && msg.timestamp < filters.startTime) {
      return false;
    }
    if (filters.endTime !== undefined && msg.timestamp > filters.endTime) {
      return false;
    }

    // Apply filter mode (OR/AND)
    if (conditions.length === 0) {
      return true; // No filters applied
    }

    if (filters.filterMode === 'AND') {
      return conditions.every(c => c);
    } else {
      // Default to OR mode
      return conditions.some(c => c);
    }
  });
}

const SEVERITY_NAMES: Record<number, string> = {
  1: 'DEBUG',
  2: 'INFO',
  4: 'WARN',
  8: 'ERROR',
  16: 'FATAL',
};

function formatTimestamp(timestamp: number, timezone: 'local' | 'utc' = 'local'): string {
  const date = new Date(timestamp * 1000);
  if (timezone === 'utc') {
    return date.toISOString().replace('T', ' ').substring(0, 23) + ' UTC';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportToCSV(messages: RosoutMessage[], timezone: 'local' | 'utc' = 'local'): string {
  const headers = ['Timestamp','Time','Node','Severity','Message','File','Line','Function','Topics'];
  const rows = messages.map(msg => [
    msg.timestamp.toFixed(6),
    formatTimestamp(msg.timestamp, timezone),
    escapeCSV(msg.node),
    SEVERITY_NAMES[msg.severity] || String(msg.severity),
    escapeCSV(msg.message),
    escapeCSV(msg.file || ''),
    String(msg.line || 0),
    escapeCSV(msg.function || ''),
    escapeCSV((msg.topics || []).join(';'))
  ]);
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

export function exportToJSON(messages: RosoutMessage[], timezone: 'local' | 'utc' = 'local'): string {
  const exportData = messages.map(msg => ({
    timestamp: msg.timestamp,
    time: formatTimestamp(msg.timestamp, timezone),
    node: msg.node,
    severity: SEVERITY_NAMES[msg.severity] || msg.severity,
    message: msg.message,
    file: msg.file || '',
    line: msg.line || 0,
    function: msg.function || '',
    topics: msg.topics || []
  }));
  return JSON.stringify(exportData, null, 2);
}

export function exportToTXT(messages: RosoutMessage[], timezone: 'local' | 'utc' = 'local'): string {
  return messages.map(msg => {
    const time = formatTimestamp(msg.timestamp, timezone);
    const severity = SEVERITY_NAMES[msg.severity] || String(msg.severity);
    const location = msg.file ? `${msg.file}:${msg.line || 0}` : '';
    let line = `[${time}] [${severity}] [${msg.node}]: ${msg.message}`;
    if (location) line += ` (${location})`;
    return line;
  }).join('\n');
}

export function exportDiagnosticsToCSV(diagnostics: DiagnosticStatusEntry[], timezone: 'local' | 'utc' = 'local'): string {
  const headers = ['Timestamp', 'Time', 'Name', 'Level', 'Message', 'Values'];
  const rows = diagnostics.map(d => [
    d.timestamp.toFixed(6),
    formatTimestamp(d.timestamp, timezone),
    escapeCSV(d.name),
    DIAGNOSTIC_LEVEL_NAMES[d.level] || String(d.level),
    escapeCSV(d.message),
    escapeCSV(d.values.map(v => `${v.key}=${v.value}`).join('; ')),
  ]);
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

export function exportDiagnosticsToJSON(diagnostics: DiagnosticStatusEntry[], timezone: 'local' | 'utc' = 'local'): string {
  const exportData = diagnostics.map(d => ({
    timestamp: d.timestamp,
    time: formatTimestamp(d.timestamp, timezone),
    name: d.name,
    level: DIAGNOSTIC_LEVEL_NAMES[d.level] || d.level,
    message: d.message,
    values: d.values,
  }));
  return JSON.stringify(exportData, null, 2);
}

export function exportDiagnosticsToTXT(diagnostics: DiagnosticStatusEntry[], timezone: 'local' | 'utc' = 'local'): string {
  return diagnostics.map(d => {
    const time = formatTimestamp(d.timestamp, timezone);
    const level = DIAGNOSTIC_LEVEL_NAMES[d.level] || String(d.level);
    let line = `[${time}] [${level}] ${d.name}: ${d.message}`;
    if (d.values.length > 0) {
      line += ` {${d.values.map(v => `${v.key}=${v.value}`).join(', ')}}`;
    }
    return line;
  }).join('\n');
}

export function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
