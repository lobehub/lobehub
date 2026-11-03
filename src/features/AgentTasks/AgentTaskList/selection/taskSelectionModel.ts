/**
 * Pure selection math for the task list's multi-select. `order` is the list's
 * selectable rows top to bottom, so ranges follow what the user sees.
 */

/** Ids one batch request may carry; mirrors the server's `TASK_BATCH_MAX_IDS`. */
export const TASK_BATCH_CHUNK_SIZE = 500;

export const toggleSelection = (selected: readonly string[], id: string): string[] =>
  selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];

/**
 * Shift+click: add every row between the anchor and `id` (inclusive) to the
 * selection. Without a usable anchor it behaves like a toggle-on of `id`.
 */
export const selectRange = (
  order: readonly string[],
  selected: readonly string[],
  anchorId: string | undefined,
  id: string,
): string[] => {
  const to = order.indexOf(id);
  const from = anchorId ? order.indexOf(anchorId) : -1;
  if (to < 0) return [...selected];
  if (from < 0) return selected.includes(id) ? [...selected] : [...selected, id];

  const [start, end] = from <= to ? [from, to] : [to, from];
  const next = new Set(selected);
  for (const rowId of order.slice(start, end + 1)) next.add(rowId);
  return [...next];
};

/**
 * Drop ids that left the list (deleted, filtered out, moved to another view)
 * so the count and the batch never act on rows the user can no longer see.
 * Returns the same array when nothing changed, to keep store updates cheap.
 */
export const pruneSelection = (
  selected: readonly string[],
  visibleIds: ReadonlySet<string>,
): readonly string[] => {
  const next = selected.filter((id) => visibleIds.has(id));
  return next.length === selected.length ? selected : next;
};

export const chunkIds = (ids: readonly string[], size = TASK_BATCH_CHUNK_SIZE): string[][] => {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
};

export interface TaskBatchOutcome {
  failed: { error: string; id: string }[];
  followUpFailed?: boolean;
  skipped: { id: string; reason: string }[];
  updated: string[];
}

export const mergeOutcomes = (outcomes: readonly TaskBatchOutcome[]): TaskBatchOutcome => ({
  failed: outcomes.flatMap((outcome) => outcome.failed),
  followUpFailed: outcomes.some((outcome) => outcome.followUpFailed),
  skipped: outcomes.flatMap((outcome) => outcome.skipped),
  updated: outcomes.flatMap((outcome) => outcome.updated),
});

/** Keyboard focus is in a text field: native shortcuts (⌘A, Esc) belong to it. */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return !!element.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
};

/**
 * How many of `tasks` another member created. A workspace batch delete may
 * remove them (same scope as deleting one task), so the confirmation has to
 * say so explicitly. Tasks without a recorded creator are not counted.
 */
export const countTasksCreatedByOthers = (
  tasks: readonly { createdByUserId?: string | null }[],
  userId: string | null | undefined,
): number => {
  if (!userId) return 0;
  return tasks.filter((task) => !!task.createdByUserId && task.createdByUserId !== userId).length;
};
