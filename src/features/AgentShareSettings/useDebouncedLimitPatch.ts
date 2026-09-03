import { useCallback, useEffect, useRef } from 'react';

import type { AgentShareConfigPatchInput } from '@/services/agentShare';

export type AgentShareLimitField = 'maxTopicsPerVisitor' | 'maxTurnsPerTopic' | 'monthlySpendLimit';
export type AgentShareLimitPatch = Pick<AgentShareConfigPatchInput, AgentShareLimitField>;

const LIMIT_COMMIT_DELAY = 500;

/**
 * Which write path a flushed patch belongs to, given the identity the patch was
 * scheduled under and the identity the component currently renders.
 *
 * `'previous'` means the flush was triggered BY the identity change itself, so
 * the patch belongs to the agent that was just navigated away from and must not
 * go through the (already re-scoped) shared write queue.
 */
export const resolveLimitCommitTarget = (
  commitIdentity: string,
  currentIdentity: string,
): 'current' | 'previous' => (commitIdentity === currentIdentity ? 'current' : 'previous');

/**
 * Debounces the numeric limit inputs into a single patch and flushes it on
 * unmount. One shared pending patch keeps one field from cancelling another,
 * and the unmount flush keeps closing the modal right after typing from
 * discarding the last valid edit.
 *
 * `identityKey` scopes the pending patch to whatever it was created for
 * (typically the agent id). The settings page component is not remounted when
 * navigating between two agents' share pages — it just receives new props, so
 * without this the refs below would carry agent A's still-pending edit into
 * agent B's `onCommit`. See {@link flush}'s call from the identity-change
 * check for how the previous identity's edit is drained before that happens.
 *
 * `onCommit` therefore receives the identity the patch was scheduled under as
 * its second argument — the PREVIOUS one when the flush was triggered by an
 * identity change. Callers must route such a patch to that identity's own
 * write path instead of the (already re-scoped) shared one; see
 * {@link resolveLimitCommitTarget}.
 */
export const useDebouncedLimitPatch = (
  identityKey: string,
  onCommit: (patch: AgentShareLimitPatch, commitIdentity: string) => Promise<void> | void,
  onSettled?: (patch: AgentShareLimitPatch) => void,
) => {
  const onCommitRef = useRef(onCommit);
  const onSettledRef = useRef(onSettled);
  const pendingRef = useRef<AgentShareLimitPatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef(identityKey);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length === 0) return;

    const settle = onSettledRef.current;
    // Not `identityKey`: `flush` is called from the identity-change check
    // BEFORE `identityRef` is advanced, so this is exactly the identity the
    // pending patch was scheduled under in every call path.
    const commitIdentity = identityRef.current;
    void Promise.resolve(onCommitRef.current(patch, commitIdentity))
      .catch(() => undefined)
      .finally(() => settle?.(patch));
  }, []);

  // `identityKey` changed since the last render (e.g. navigating agent A's
  // share page -> agent B's without this component unmounting): drain
  // whatever is pending through the PREVIOUS identity's `onCommit`/`onSettled`
  // — both refs below still hold them here, since they are not reassigned
  // until right after. Comparing against `identityRef` (rather than
  // unconditionally flushing every render) makes this idempotent under
  // StrictMode's render double-invocation — the refs persist across the two
  // calls, so the second sees `identityRef.current === identityKey` already
  // and is a no-op.
  if (identityRef.current !== identityKey) {
    flush();
    identityRef.current = identityKey;
  }

  onCommitRef.current = onCommit;
  onSettledRef.current = onSettled;

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
