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
  onCommitError?: (patch: AgentShareLimitPatch) => void,
) => {
  const onCommitRef = useRef(onCommit);
  const onCommitErrorRef = useRef(onCommitError);
  const pendingPatchRef = useRef<AgentShareLimitPatch>({});
  /**
   * The callbacks captured when the pending patch was scheduled. The settings
   * surface is reused across agents, so by the time the timer fires the props
   * may already point at a different agent's `updateConfig` — committing
   * through those would silently write agent A's limits onto agent B.
   */
  const pendingCommitRef = useRef<{
    onCommit: typeof onCommit;
    onCommitError: typeof onCommitError;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onCommitRef.current = onCommit;
  onCommitErrorRef.current = onCommitError;

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    const patch = pendingPatchRef.current;
    const captured = pendingCommitRef.current;
    pendingPatchRef.current = {};
    pendingCommitRef.current = null;
    if (Object.keys(patch).length > 0) {
      const commit = captured?.onCommit ?? onCommitRef.current;
      const commitError = captured?.onCommitError ?? onCommitErrorRef.current;
      try {
        void Promise.resolve(commit(patch)).catch(() => commitError?.(patch));
      } catch {
        commitError?.(patch);
      }
    }
  }, []);

  useEffect(() => flush, [flush]);

  return useCallback(
    (field: AgentShareLimitField, value: number | null) => {
      // The settings surface is reused across agents. If a patch is still
      // pending for a different agent's `onCommit` when a new edit comes in,
      // flush it now — otherwise the merge below would fold this edit into
      // the previous agent's patch and both fields would land on whichever
      // agent's callback happens to be captured last.
      if (pendingCommitRef.current && pendingCommitRef.current.onCommit !== onCommitRef.current) {
        flush();
      }

      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        const nextPatch = { ...pendingPatchRef.current };
        delete nextPatch[field];
        pendingPatchRef.current = nextPatch;

        if (Object.keys(nextPatch).length === 0 && timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
          pendingCommitRef.current = null;
        }
        return;
      }

      pendingPatchRef.current = { ...pendingPatchRef.current, [field]: value };
      // Bind the patch to the agent it was typed for, not to whichever agent
      // happens to be mounted when the debounce elapses.
      pendingCommitRef.current = {
        onCommit: onCommitRef.current,
        onCommitError: onCommitErrorRef.current,
      };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, LIMIT_COMMIT_DELAY);
    },
    [flush],
  );
};
