import { useCallback, useEffect, useRef } from 'react';

export type AgentShareLimitField = 'maxTopicsPerVisitor' | 'maxTurnsPerTopic';
export type AgentShareLimitPatch = Partial<Record<AgentShareLimitField, number>>;

const LIMIT_COMMIT_DELAY = 500;

/**
 * Debounces both visitor-limit inputs as one patch and flushes it on unmount.
 * A shared pending patch prevents one field from cancelling the other, while
 * the cleanup keeps a modal close from discarding the latest valid edit.
 */
export const useDebouncedLimitPatch = (
  onCommit: (patch: AgentShareLimitPatch) => Promise<void> | void,
) => {
  const onCommitRef = useRef(onCommit);
  const pendingPatchRef = useRef<AgentShareLimitPatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onCommitRef.current = onCommit;

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(patch).length > 0) void onCommitRef.current(patch);
  }, []);

  useEffect(() => flush, [flush]);

  return useCallback(
    (field: AgentShareLimitField, value: number | null) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return;

      pendingPatchRef.current = { ...pendingPatchRef.current, [field]: value };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, LIMIT_COMMIT_DELAY);
    },
    [flush],
  );
};
