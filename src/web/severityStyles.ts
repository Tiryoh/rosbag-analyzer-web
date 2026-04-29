/**
 * Tailwind class strings used by the React UI to render severity and
 * diagnostic levels. Kept separate from core types so the non-UI packages
 * (core parsing, future TUI) don't need to know about Tailwind.
 */
import type { SeverityLevel } from '../core/types';

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
