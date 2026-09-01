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
 * sharing on. `enable` mints the row with `link` visibility; `disable` deletes
 * it, which is what makes the handed-out link stop resolving — re-enabling
 * mints a new share id, i.e. a NEW url (see `AgentShareModel.create`).
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
   * `disable` nulls `latestConfigRef` before its request is even sent, so an
   * edit landing in that window has no base to resolve against — but the row
   * may still be there afterwards if the delete fails. These three hold that
   * window open: whether a delete is in flight, the config as of the moment it
   * started (a base for functional patches), and the accumulated patch to
   * replay if the share turns out to have survived.
   */
  const disablePendingRef = useRef(false);
  const disableBaseRef = useRef<AgentShareConfigState | null>(null);
  const bufferedPatchRef = useRef<AgentShareConfigPatchInput | null>(null);

  // Only adopt a server snapshot while idle: mid-flight it would be older than
  // the local projection above.
  useEffect(() => {
    if (pendingWritesRef.current > 0) return;
    latestConfigRef.current = share === undefined ? undefined : (share?.shareConfig ?? null);
  }, [share]);

  /**
   * Every mutation replaces the whole row in the SWR cache, so two writes that
   * resolve out of order would let the older response win.
   */
  const queueRef = useRef<Promise<unknown> | null>(null);
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
        latestConfigRef.current = updated.shareConfig;
        await mutate(updated, { revalidate: false });
      }),
    [agentId, enqueue, mutate],
  );

  const updateConfig = useCallback(
    (patch: AgentShareConfigPatch) => {
      const base = latestConfigRef.current;
      // No share row to write against. Two very different reasons:
      if (!base) {
        // (a) A disable is in flight. Writing now would raise NOT_FOUND, but
        //     simply dropping the patch loses the edit for good if the delete
        //     then fails — callers like the debounced limit patch read a
        //     resolved promise as "saved" and clear their draft. Buffer it and
        //     let `disable` decide: discarded on success, replayed on failure.
        if (disablePendingRef.current && disableBaseRef.current) {
          const buffered = bufferedPatchRef.current ?? {};
          const bufferBase = mergeShareConfig(disableBaseRef.current, buffered);
          const resolvedWhileDisabling = typeof patch === 'function' ? patch(bufferBase) : patch;
          bufferedPatchRef.current = { ...buffered, ...resolvedWhileDisabling };
        }
        // (b) Nothing is loaded yet, or sharing is genuinely off — nothing to do.
        return Promise.resolve();
      }

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
          // A disable that raced this write already invalidated the row; do not
          // resurrect it in the cache.
          if (latestConfigRef.current === null) return;
          latestConfigRef.current = updated.shareConfig;
          await mutate(updated, { revalidate: false });
        } catch (error) {
          // Drop the optimistic projection and re-read the server truth; the
          // effect above re-seeds `latestConfigRef` once the queue drains.
          void mutate();
          throw error;
        } finally {
          pendingWritesRef.current -= 1;
        }
      });
    },
    [agentId, enqueue, mutate],
  );

  const disable = useCallback(() => {
    // Marked gone BEFORE the request so a debounced patch flushed on unmount
    // in the same tick does not write to a row that is about to disappear.
    const previousConfig = latestConfigRef.current;
    latestConfigRef.current = null;
    disablePendingRef.current = true;
    disableBaseRef.current = previousConfig ?? null;
    bufferedPatchRef.current = null;

    return enqueue(async () => {
      try {
        await agentShareService.disableShare(agentId);
      } catch (error) {
        // The share is still there. Restore the local projection and replay
        // anything edited while the delete was in flight, otherwise that edit
        // is silently lost even though its owner never left the surface.
        latestConfigRef.current = previousConfig;
        disablePendingRef.current = false;
        const buffered = bufferedPatchRef.current;
        bufferedPatchRef.current = null;
        // Fire-and-forget: the caller is already learning the disable failed,
        // and a failed replay rolls back its own optimistic projection.
        if (buffered) void updateConfig(buffered).catch(() => undefined);
        throw error;
      }

      // The row really is gone, so anything buffered against it is moot.
      disablePendingRef.current = false;
      bufferedPatchRef.current = null;
      await mutate(null, { revalidate: false });
    });
  }, [agentId, enqueue, mutate, updateConfig]);

  const updateSlug = useCallback(
    (slug: string | null) =>
      enqueue(async () => {
        const updated = await agentShareService.updateSlug(agentId, slug);
        latestConfigRef.current = updated.shareConfig;
        await mutate(updated, { revalidate: false });
      }),
    [agentId, enqueue, mutate],
  );

  return { disable, enable, error, isLoading, mutate, share, updateConfig, updateSlug };
};
