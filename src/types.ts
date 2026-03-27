export type SeverityLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'UNKNOWN';

export interface RosoutMessage {
  timestamp: number;
  node: string;
  severity: SeverityLevel;
  message: string;
  file?: string;
  line?: number;
  function?: string;
  topics?: string[];
}

export interface FilterConfig {
  nodeNames: Set<string>;
  severityLevels: Set<SeverityLevel>;
  messageKeywords: string[];
  messageRegex: string;
  filterMode: 'OR' | 'AND';
  useRegex: boolean;
}

// ROS1 numeric severity → SeverityLevel
export const ROS1_SEVERITY: Record<number, SeverityLevel> = {
  1: 'DEBUG',
  2: 'INFO',
  4: 'WARN',
  8: 'ERROR',
  16: 'FATAL',
};

// ROS2 numeric severity → SeverityLevel
export const ROS2_SEVERITY: Record<number, SeverityLevel> = {
  10: 'DEBUG',
  20: 'INFO',
  30: 'WARN',
  40: 'ERROR',
  50: 'FATAL',
};

export const SEVERITY_LEVELS: SeverityLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'UNKNOWN'];

export const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  'DEBUG': 'text-surface-400',
  'INFO': 'text-emerald-600 dark:text-emerald-400',
  'WARN': 'text-amber-600 dark:text-amber-400',
  'ERROR': 'text-red-600 dark:text-red-400',
  'FATAL': 'text-red-700 dark:text-red-300 font-bold',
  'UNKNOWN': 'text-surface-500 dark:text-surface-400 italic',
};

export const SEVERITY_BG_COLORS: Record<SeverityLevel, string> = {
  'DEBUG': 'bg-surface-100/50 dark:bg-surface-800/30',
  'INFO': 'bg-emerald-50 dark:bg-emerald-950/30',
  'WARN': 'bg-amber-50 dark:bg-amber-950/30',
  'ERROR': 'bg-red-50 dark:bg-red-950/30',
  'FATAL': 'bg-red-100 dark:bg-red-950/50',
  'UNKNOWN': 'bg-surface-100/50 dark:bg-surface-800/30',
};

// Diagnostics types
export interface DiagnosticStatusEntry {
  timestamp: number;
  name: string;
  level: number;
  message: string;
  values: { key: string; value: string }[];
}

export const DIAGNOSTIC_LEVEL_NAMES: Record<number, string> = {
  0: 'OK',
  1: 'WARN',
  2: 'ERROR',
  3: 'STALE',
};

export const DIAGNOSTIC_LEVEL_COLORS: Record<number, string> = {
  0: 'text-emerald-600 dark:text-emerald-400',
  1: 'text-amber-600 dark:text-amber-400',
  2: 'text-red-600 dark:text-red-400',
  3: 'text-surface-400',
};

export const DIAGNOSTIC_LEVEL_BG_COLORS: Record<number, string> = {
  0: 'bg-emerald-50 dark:bg-emerald-950/30',
  1: 'bg-amber-50 dark:bg-amber-950/30',
  2: 'bg-red-50 dark:bg-red-950/30',
  3: 'bg-surface-100/50 dark:bg-surface-800/30',
};
