export type SeverityLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'UNKNOWN';

/**
 * Platform-agnostic input for the bag/MCAP loaders.
 *
 * Core loaders accept a BagSource so they do not depend on the browser `File`
 * API. `read(offset, length)` is a lazy random-access primitive: in the
 * browser it is backed by `Blob.slice()`, so a multi-GB file is never
 * materialized as a single Uint8Array. `size` is the total byte length.
 */
export interface BagSource {
  name: string;
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * Structured error from core loaders. The `code` is an i18n key (resolved at
 * the UI boundary); `params` carries placeholder values for `tf()`.
 */
export class BagLoadError extends Error {
  readonly code: string;
  readonly params: Record<string, string | number>;
  constructor(code: string, params: Record<string, string | number> = {}) {
    super(code);
    this.name = 'BagLoadError';
    this.code = code;
    this.params = params;
  }
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

/** A topic/channel discovered in the loaded file (for the "no relevant topics" notice). */
export interface TopicInfo {
  topic: string;
  type: string;
}

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
