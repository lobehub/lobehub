import { useCallback, useRef } from 'react';

const RESOLVED: Promise<unknown> = Promise.resolve();

/**
 * Serialized workbook byte store with undo/redo history.
 *
 * Every mutation runs strictly after the previous one and reads the bytes that
 * operation produced. React state alone is unsafe for this: two rapid
 * operations would both close over the same stale bytes and the second would
 * silently drop the first edit.
 */
export const useWorkbookQueue = (onChange: (bytes: ArrayBuffer) => Promise<void>) => {
  const bytesRef = useRef<ArrayBuffer | undefined>(undefined);
  const undoStackRef = useRef<ArrayBuffer[]>([]);
  const redoStackRef = useRef<ArrayBuffer[]>([]);
  const queueRef = useRef(RESOLVED);

  const enqueue = useCallback((task: () => Promise<void>) => {
    const run = queueRef.current.then(task, task);
    queueRef.current = run.catch((error) =>
      console.error('[useWorkbookQueue] operation failed:', error),
    );
    return queueRef.current;
  }, []);

  /** Seed the store with freshly loaded bytes without touching history. */
  const initialize = useCallback((bytes: ArrayBuffer) => {
    bytesRef.current = bytes;
  }, []);

  const apply = useCallback(
    (edit: (current: ArrayBuffer) => Promise<ArrayBuffer>) =>
      enqueue(async () => {
        const current = bytesRef.current;
        if (!current) return;
        undoStackRef.current.push(current);
        redoStackRef.current = [];
        const next = await edit(current);
        bytesRef.current = next;
        await onChange(next);
      }),
    [enqueue, onChange],
  );

  const undo = useCallback(
    () =>
      enqueue(async () => {
        const current = bytesRef.current;
        const previous = undoStackRef.current.pop();
        if (!current || !previous) return;
        redoStackRef.current.push(current);
        bytesRef.current = previous;
        await onChange(previous);
      }),
    [enqueue, onChange],
  );

  const redo = useCallback(
    () =>
      enqueue(async () => {
        const current = bytesRef.current;
        const next = redoStackRef.current.pop();
        if (!current || !next) return;
        undoStackRef.current.push(current);
        bytesRef.current = next;
        await onChange(next);
      }),
    [enqueue, onChange],
  );

  /** Read the up-to-date bytes after all pending edits settle (save/export). */
  const withCurrent = useCallback(
    (task: (current: ArrayBuffer) => Promise<void> | void) =>
      enqueue(async () => {
        if (bytesRef.current) await task(bytesRef.current);
      }),
    [enqueue],
  );

  return { apply, initialize, redo, redoStackRef, undo, undoStackRef, withCurrent };
};
