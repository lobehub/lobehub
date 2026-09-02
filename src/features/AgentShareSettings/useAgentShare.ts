import { useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import type { AgentShareConfigPatchInput } from '@/services/agentShare';
import { agentShareService } from '@/services/agentShare';

import { mergeShareConfig } from './shareConfigPatch';

export type AgentShareInfo = Awaited<ReturnType<typeof agentShareService.getShareStatus>>;
/** Server-normalized share config (every optional field already defaulted). */
export type AgentShareConfigState = NonNullable<AgentShareInfo>['shareConfig'];

/**
 * A config patch, or a function producing one from the LATEST known config.
 * Use the function form for any edit derived from the current value (toggling
 * an item in `enabledToolIds`, say) — a plain object captures whatever the
 * component rendered with, which is stale the moment a previous write is
 * still in flight.
 */
export type AgentShareConfigPatch =
  AgentShareConfigPatchInput | ((current: AgentShareConfigState) => AgentShareConfigPatchInput);

/**
 * Creator-side share state for one agent.
 *
 * Unlike a topic share, sharing an agent lets link holders RUN it on the
 * creator's account, so nothing is created until the owner explicitly turns
 * sharing on. `enable` mints (or republishes) the row with `link` visibility;
 * `disable` only flips it back to `private`, keeping the share id and slug so
 * the same url resumes on the next enable (see `AgentShareModel`).
 */
export const useAgentShare = (agentId: string) => {
  const {
    data: share,
    error,
    isLoading,
    mutate,
  } = useSWR(shareKeys.agentShareStatus(agentId), () => agentShareService.getShareStatus(agentId), {
    revalidateOnFocus: false,
  });

  /**
   * The config as it will be once every write issued so far has landed —
   * `undefined` while unknown, `null` once the share row is known to be gone.
   * Patches resolve against THIS, not against the last rendered `share`, so
   * two edits fired before the first response composes rather than the second
   * overwriting the first.
   */
  const latestConfigRef = useRef<AgentShareConfigState | null | undefined>(undefined);
  const pendingWritesRef = useRef(0);

  /**
   * `agentId` identity this hook instance is currently tracking. The owning
   * settings page component is NOT remounted when navigating between two
   * agents' share pages (it just receives a new `agentId` prop), so every ref
   * above survives the switch unless reset here — mirrors the pattern in
   * `useDebouncedLimitPatch`.
   */
  const identityRef = useRef(agentId);
  /**
   * Every mutation replaces the whole row in the SWR cache, so two writes that
   * resolve out of order would let the older response win — see `enqueue`
   * below. Declared here (rather than next to `enqueue`) so the identity-change
   * reset can null it out too.
   */
  const queueRef = useRef<Promise<unknown> | null>(null);

  // `agentId` changed since the last render: reset adoption state right away
  // (render-time, not in an effect) so the idle-adoption effect below picks
  // up the NEW agent's server snapshot on its very next run instead of
  // staying blocked behind the OLD agent's still-in-flight write count.
  // Comparing against `identityRef` (rather than unconditionally resetting
  // every render) makes this idempotent under StrictMode's render
  // double-invocation, same as `useDebouncedLimitPatch`.
  //
  // `queueRef` is also cut loose (set to `null`, not awaited/drained): the
  // NEXT write — now for the new agent — must not queue behind whatever A
  // still has in flight, since that write targets an entirely different SWR
  // key/resource and there is no ordering to preserve across the two. A's own
  // promise chain keeps running independently; its resolution is simply
  // ignored by `commitIfCurrent` once `identityRef` no longer matches (see
  // below), so nothing is lost — the request already landed server-side.
  if (identityRef.current !== agentId) {
    identityRef.current = agentId;
    latestConfigRef.current = undefined;
    pendingWritesRef.current = 0;
    queueRef.current = null;
  }

  // Only adopt a server snapshot while idle: mid-flight it would be older than
  // the local projection above.
  useEffect(() => {
    if (pendingWritesRef.current > 0) return;
    latestConfigRef.current = share === undefined ? undefined : (share?.shareConfig ?? null);
  }, [share]);

  /**
   * Apply a write's server response to the shared refs only if `agentId`
   * hasn't changed since the write was issued. A write started for agent A
   * can still resolve after navigating to agent B (this hook instance is
   * reused, not remounted) — its resolved value must be dropped instead of
   * clobbering `latestConfigRef`/the SWR cache entry B's edits now derive
   * from. The network write itself is never cancelled: A's request already
   * landed server-side by the time this runs; only the LOCAL bookkeeping is
   * skipped.
   */
  const commitIfCurrent = useCallback(
    async (writeIdentity: string, updated: AgentShareInfo) => {
      if (identityRef.current !== writeIdentity) return;
      latestConfigRef.current = updated?.shareConfig ?? null;
      await mutate(updated, { revalidate: false });
    },
    [mutate],
  );

  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const tail = queueRef.current ?? Promise.resolve();
    // Both handlers run `task`: a failed write must reject its own caller
    // without stalling the writes queued behind it.
    const result = tail.then(task, task);
    queueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const enable = useCallback(
    () =>
      enqueue(async () => {
        // `create` returns any pre-existing row untouched, so a legacy
        // `private` row still needs the explicit flip to `link`.
        const created = await agentShareService.enableShare(agentId, 'link');
        const updated =
          created.visibility === 'link'
            ? created
            : await agentShareService.updateVisibility(agentId, 'link');
        await commitIfCurrent(agentId, updated);
      }),
    [agentId, commitIfCurrent, enqueue],
  );

  const updateConfig = useCallback(
    (patch: AgentShareConfigPatch) => {
      const base = latestConfigRef.current;
      // Nothing loaded yet, or this agent has no share row at all — there is
      // nothing to write against. (Turning sharing OFF does not land here: the
      // row survives as `private`, so its config stays editable.)
      if (!base) return Promise.resolve();

      const resolved = typeof patch === 'function' ? patch(base) : patch;
      // Project the patch locally right away, so the control reflects the edit
      // immediately AND the next patch composes on top of this one.
      latestConfigRef.current = mergeShareConfig(base, resolved);
      const optimisticConfig = latestConfigRef.current;
      pendingWritesRef.current += 1;
      void mutate(
        (current) => (current ? { ...current, shareConfig: optimisticConfig } : current),
        {
          revalidate: false,
        },
      );

      return enqueue(async () => {
        try {
          const updated = await agentShareService.updateShareConfig(agentId, resolved);
          await commitIfCurrent(agentId, updated);
        } catch (error) {
          // Drop the optimistic projection and re-read the server truth; the
          // effect above re-seeds `latestConfigRef` once the queue drains.
          // Skipped once `agentId` has moved on — that re-read effect now
          // belongs to a different agent's `mutate`/`share` pair.
          if (identityRef.current === agentId) void mutate();
          throw error;
        } finally {
          // The reset on identity change already zeroed this counter for the
          // NEW agent; a write issued under the OLD agent must not decrement
          // it again once it settles late.
          if (identityRef.current === agentId) pendingWritesRef.current -= 1;
        }
      });
    },
    [agentId, commitIfCurrent, enqueue, mutate],
  );

  /**
   * Pause sharing. The row survives as `private`, so nothing local needs
   * invalidating: an edit issued in the same tick (a debounced limit patch
   * flushed on unmount, say) simply queues behind this write and lands on the
   * row it was always meant for.
   */
  const disable = useCallback(
    () =>
      enqueue(async () => {
        const disabled = await agentShareService.disableShare(agentId);
        await commitIfCurrent(agentId, disabled);
      }),
    [agentId, commitIfCurrent, enqueue],
  );

  const updateSlug = useCallback(
    (slug: string | null) =>
      enqueue(async () => {
        const updated = await agentShareService.updateSlug(agentId, slug);
        await commitIfCurrent(agentId, updated);
      }),
    [agentId, commitIfCurrent, enqueue],
  );

  return { disable, enable, error, isLoading, mutate, share, updateConfig, updateSlug };
};
