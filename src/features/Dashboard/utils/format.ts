import type { WidgetTableCell } from '@lobechat/types';

/** Cap for stdout / stderr shown inline; the server already truncates what it stores. */
export const LOG_PREVIEW_LIMIT = 4000;

export const truncateLog = (text: string | null | undefined, limit = LOG_PREVIEW_LIMIT) => {
  if (!text) return { text: '', truncated: false };
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
};

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/**
 * Format a stat value exactly as the script reported it. Strings pass through
 * untouched — '1.2k' or 'N/A' are the script's own words — and only finite
 * numbers get locale grouping.
 */
export const formatWidgetValue = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? numberFormat.format(value) : '';
  return value;
};

export const formatDelta = (delta: number | string | undefined): string | undefined => {
  if (delta === undefined || delta === null) return undefined;
  if (typeof delta === 'number') {
    if (!Number.isFinite(delta)) return undefined;
    return `${delta > 0 ? '+' : ''}${numberFormat.format(delta)}`;
  }
  return delta;
};

export const formatCell = (cell: WidgetTableCell | undefined): string => {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return numberFormat.format(cell);
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  return cell;
};

export const formatDuration = (ms: number | null | undefined): string | undefined => {
  if (ms === null || ms === undefined) return undefined;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
};
