export type SeverityLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'UNKNOWN';

/**
 * Platform-agnostic input for the bag/MCAP loaders.
 *
 * Core loaders accept a BagSource so they do not depend on the browser `File`
 * API. The `name` is used for format detection (extension) and diagnostics;
 * `data` is the full byte content of the file.
 */
export interface BagSource {
  name: string;
  data: Uint8Array;
}

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
