import type { TaskBatchRevert } from '../optimisticBatch';

/**
 * How to undo one committed batch. Status / field / archive changes carry the
 * server's `reverts` (each task's replaced values, read under its row lock);
 * a delete undoes by restoring the tasks from the recycle bin.
 */
export type TaskBatchUndoEntry =
  | { id: number; kind: 'revert'; reverts: TaskBatchRevert[] }
  | { id: number; kind: 'restore'; taskIds: string[] };

/** Batches ⌘Z can still reach. Session memory only: a reload starts empty. */
export const TASK_BATCH_UNDO_LIMIT = 10;

let entries: TaskBatchUndoEntry[] = [];
let nextId = 1;

type NewEntry =
  { kind: 'revert'; reverts: TaskBatchRevert[] } | { kind: 'restore'; taskIds: string[] };

export const pushUndoEntry = (entry: NewEntry): TaskBatchUndoEntry => {
  const pushed = { ...entry, id: nextId++ } as TaskBatchUndoEntry;
  entries = [...entries, pushed].slice(-TASK_BATCH_UNDO_LIMIT);
  return pushed;
};

/**
 * Take an entry off the stack so it is undone at most once (the toast button
 * and ⌘Z can race). Returns whether it was still there.
 */
export const takeUndoEntry = (id: number): boolean => {
  const before = entries.length;
  entries = entries.filter((entry) => entry.id !== id);
  return entries.length < before;
};

export const peekLastUndoEntry = (): TaskBatchUndoEntry | undefined => entries.at(-1);

/** Test helper. */
export const resetUndoStack = () => {
  entries = [];
  nextId = 1;
};
