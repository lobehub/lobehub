import { useCallback, useRef } from 'react';

const RESOLVED: Promise<void> = Promise.resolve();

/**
 * Serializes document mutations and keeps history against the latest bytes.
 *
 * React state is intentionally not the source of truth here. Back-to-back
 * toolbar actions otherwise close over the same buffer and the later action
 * silently replaces the earlier edit.
 */
export const useOfficeDocumentQueue = (
  onChange: (bytes: ArrayBuffer) => Promise<void>,
  onError?: (error: unknown) => void,
) => {
  const bytesRef = useRef<ArrayBuffer | undefined>(undefined);
  const undoStackRef = useRef<ArrayBuffer[]>([]);
  const redoStackRef = useRef<ArrayBuffer[]>([]);
  const queueRef = useRef(RESOLVED);

  const enqueue = useCallback(
    (task: () => Promise<void>) => {
      const run = queueRef.current.then(task, task);
      queueRef.current = run.catch((error) => {
        onError?.(error);
      });
      return queueRef.current;
    },
    [onError],
  );

  const initialize = useCallback((bytes: ArrayBuffer) => {
    bytesRef.current = bytes;
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  const apply = useCallback(
    (edit: (current: ArrayBuffer) => Promise<ArrayBuffer>) =>
      enqueue(async () => {
        const current = bytesRef.current;
        if (!current) return;
        const next = await edit(current.slice(0));
        undoStackRef.current = [...undoStackRef.current.slice(-19), current];
        redoStackRef.current = [];
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

  const withCurrent = useCallback(
    (task: (current: ArrayBuffer) => Promise<void> | void) =>
      enqueue(async () => {
        if (bytesRef.current) await task(bytesRef.current);
      }),
    [enqueue],
  );

  return { apply, initialize, redo, redoStackRef, undo, undoStackRef, withCurrent };
};
