/**
 * Character count of the original parsed text, recorded in document `metadata` when the stored
 * `content` was cut at parse time. `undefined` for documents stored in full.
 */
export const readOriginalCharCount = (
  metadata: Record<string, unknown> | null | undefined,
): number | undefined => {
  const value = metadata?.originalCharCount;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};
