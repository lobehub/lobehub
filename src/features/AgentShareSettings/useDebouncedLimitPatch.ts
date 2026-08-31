import { useCallback, useEffect, useRef } from 'react';

import type { AgentShareConfigPatchInput } from '@/services/agentShare';

export type AgentShareLimitField = 'maxTopicsPerVisitor' | 'maxTurnsPerTopic' | 'monthlySpendLimit';
export type AgentShareLimitPatch = Pick<AgentShareConfigPatchInput, AgentShareLimitField>;

const LIMIT_COMMIT_DELAY = 500;

/**
 * Debounces the numeric limit inputs into a single patch and flushes it on
 * unmount. One shared pending patch keeps one field from cancelling another,
 * and the unmount flush keeps closing the modal right after typing from
 * discarding the last valid edit.
 */
export const useDebouncedLimitPatch = (
  onCommit: (patch: AgentShareLimitPatch) => Promise<void> | void,
  onSettled?: (patch: AgentShareLimitPatch) => void,
) => {
  const onCommitRef = useRef(onCommit);
  const onSettledRef = useRef(onSettled);
  const pendingRef = useRef<AgentShareLimitPatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onCommitRef.current = onCommit;
  onSettledRef.current = onSettled;

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length === 0) return;

    const settle = onSettledRef.current;
    void Promise.resolve(onCommitRef.current(patch))
      .catch(() => undefined)
      .finally(() => settle?.(patch));
  }, []);

  useEffect(() => flush, [flush]);

  const schedule = useCallback(
    (patch: AgentShareLimitPatch) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, LIMIT_COMMIT_DELAY);
    },
    [flush],
  );

  return schedule;
};
