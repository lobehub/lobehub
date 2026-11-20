import type { AcceptanceItem } from '@/database/schemas/verify';

/** Execution context stays server-owned; the bundle exposes only its authorized progress view. */
export function acceptanceResponse<T extends Pick<AcceptanceItem, 'metadata'>>(row: T): T {
  const { repair: _repair, repairSource: _source, ...metadata } = row.metadata ?? {};
  return { ...row, metadata: row.metadata ? metadata : null };
}
