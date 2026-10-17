import dayjs from 'dayjs';

/**
 * Month (`2026-03`) and year (`2025`) bucket ids format themselves; the fixed
 * buckets (`today`, `week`, …) return `undefined` for the caller to translate.
 */
export const formatTimeGroupId = (id: string) =>
  id.startsWith('20') ? (id.includes('-') ? dayjs(id).format('MMMM') : id) : undefined;
