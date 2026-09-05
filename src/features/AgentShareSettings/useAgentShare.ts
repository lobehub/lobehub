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
 * a tool in `toolGrants`, say) — a plain object captures whatever the
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
   * A functional patch's UI-facing preview resolves against THIS at CALL
   * time, so two edits fired before the first response composes visually
   * rather than the second overwriting the first. It does NOT drive the
   * network payload any more — see `sendConfigRef` for why the two had to
   * split.
   */
  const latestConfigRef = useRef<AgentShareConfigState | null | undefined>(undefined);
  /**
   * Mirrors `latestConfigRef`, but only ever advances/rolls back at SEND
   * time, inside a queued `updateConfig` task — never at call time. This is
   * what a functional patch's OUTGOING payload resolves against.
   *
   * Why call-time resolution isn't enough: say two functional edits are
   * queued back to back — toggle tool A (sends `toolGrants: [A]`), then
   * toggle tool B. If B's payload were baked at call time from
   * `latestConfigRef` (which already includes A's optimistic projection),
   * it would resolve to `[A, B]` regardless of what happens to A's write.
   * If A's request then FAILS, the server never persisted A — but the queue
   * still sends B's already-baked `[A, B]`, silently re-persisting A anyway.
   * `mergeShareConfig` / `AgentShareModel.updateConfig` overwrite whole
   * jsonb keys rather than diffing them, so B's write can't just apply a
   * delta on top of whatever the server actually has; it sends the full
   * array it was told to send.
   *
   * Resolving each patch against `sendConfigRef` at SEND time instead fixes
   * this: `enqueue` serializes writes strictly (a queued task's body does
   * not start until every earlier task has fully settled), so by the time
   * B's task runs, A's outcome is already known. A success advances
   * `sendConfigRef` to include A; a failure rolls it back to exclude A
   * (see the `catch` branch in `updateConfig`) — either way B resolves its
   * patch against the config the server will actually see, so a failed A
   * never leaks into B's request.
   */
  const sendConfigRef = useRef<AgentShareConfigState | null | undefined>(undefined);
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
   * Monotonic counter bumped on every `agentId` change. Comparing the bare
   * `agentId` string is not enough to tell a stale write from a current one:
   * after an A → B → A round trip `identityRef` reads `A` again, so a write
   * issued under the FIRST A (still in flight, its counter already zeroed by
   * the reset below) would pass an id-only check and decrement the second
   * A's `pendingWritesRef` — possibly below zero — and `commitIfCurrent`
   * would adopt its stale response over edits issued after the return. Each
   * write captures the generation it was issued under and compares against
   * this instead, so the two A's are distinct.
   */
  const generationRef = useRef(0);
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
    generationRef.current += 1;
    latestConfigRef.current = undefined;
    sendConfigRef.current = undefined;
    pendingWritesRef.current = 0;
    queueRef.current = null;
  }

  // Only adopt a server snapshot while idle: mid-flight it would be older than
  // the local projection above. Keep both refs in lockstep — an idle re-seed
  // is a fresh confirmed baseline, so there is no pending edit for
  // `sendConfigRef` to preserve over it either.
  useEffect(() => {
    if (pendingWritesRef.current > 0) return;
    const next = share === undefined ? undefined : (share?.shareConfig ?? null);
    latestConfigRef.current = next;
    sendConfigRef.current = next;
  }, [share]);

  /**
   * Apply a write's server response to the shared refs only if the identity
   * generation hasn't moved since the write was issued. A write started for agent A
   * can still resolve after navigating to agent B (this hook instance is
   * reused, not remounted) — its resolved value must be dropped instead of
   * clobbering `latestConfigRef`/the SWR cache entry B's edits now derive
   * from. The network write itself is never cancelled: A's request already
   * landed server-side by the time this runs; only the LOCAL bookkeeping is
   * skipped.
   *
   * Also skipped while a LATER write is still queued or in flight
   * (`pendingWritesRef.current > 1`, this write itself included). Every
   * write — from `updateConfig` to `enable`/`disable`/`updateSlug` — is
   * serialized through the same `queueRef` chain, but each one's outgoing
   * patch is computed synchronously at call time from `latestConfigRef`, not
   * re-derived when it actually sends. If an EARLIER write's response were
   * adopted here while a later write is still pending, it would regress
   * `latestConfigRef` back to a snapshot older than what the later write's
   * patch was already built from — and because `mergeShareConfig` /
   * `AgentShareModel.updateConfig` overwrite whole jsonb keys rather than
   * diffing them, the later write's request would then silently REVERT the
   * edit this response is trying to confirm once it lands. Only the LAST
   * pending write's response is guaranteed to reflect every earlier write's
   * effect (the server processes them in the same serial order they were
   * sent), so only it is allowed to update the shared refs / SWR cache.
   */
  const commitIfCurrent = useCallback(
    async (writeGeneration: number, updated: AgentShareInfo) => {
      if (generationRef.current !== writeGeneration) return;
      if (pendingWritesRef.current > 1) return;
      latestConfigRef.current = updated?.shareConfig ?? null;
      // The server response reflects every write processed so far, so it is
      // also a fresh confirmed baseline for `sendConfigRef` — any patch still
      // resolving against it from here composes on top of a value the server
      // agrees with, not a locally-mirrored guess.
      sendConfigRef.current = latestConfigRef.current;
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

  /**
   * Wrap a queued write with pending-write accounting, shared by every write
   * (`enable`/`disable`/`updateConfig`/`updateSlug`) so `commitIfCurrent` can
   * tell whether its own response is the last one outstanding — see its
   * comment above. Increments as soon as the write is issued (covers time
   * spent queued behind an earlier write, not just its own network round
   * trip) and decrements once it settles either way.
   *
   * The task receives the identity generation it was issued under, so it can
   * hand that to `commitIfCurrent` / its own late identity checks.
   */
  const runWrite = useCallback(
    <T>(task: (generation: number) => Promise<T>): Promise<T> => {
      const generation = generationRef.current;
      pendingWritesRef.current += 1;
      return enqueue(() => task(generation))
        .finally(() => {
          // The reset on identity change already zeroed this counter for the
          // NEW generation; a write issued under an OLD one must not decrement
          // it again once it settles late.
          if (generationRef.current === generation) pendingWritesRef.current -= 1;
        })
        .catch((error) => {
          // A failed write may have been the LAST one queued, in which case
          // `commitIfCurrent` already discarded every earlier write's response
          // on the assumption that this one would carry their combined effect.
          // Nothing else will refresh the cache (focus revalidation is off), so
          // re-read the server truth here; the idle re-sync effect re-seeds
          // `latestConfigRef` once the queue drains. Skipped once the identity
          // generation has moved on — that `mutate` belongs to another agent
          // (or an earlier visit to this one).
          if (generationRef.current === generation) void mutate();
          throw error;
        });
    },
    [enqueue, mutate],
  );

  const enable = useCallback(
    () =>
      runWrite(async (generation) => {
        // `create` returns any pre-existing row untouched, so a legacy
        // `private` row still needs the explicit flip to `link`.
        const created = await agentShareService.enableShare(agentId, 'link');
        const updated =
          created.visibility === 'link'
            ? created
            : await agentShareService.updateVisibility(agentId, 'link');
        await commitIfCurrent(generation, updated);
      }),
    [agentId, commitIfCurrent, runWrite],
  );

  const updateConfig = useCallback(
    (patch: AgentShareConfigPatch) => {
      const base = latestConfigRef.current;
      // Nothing loaded yet, or this agent has no share row at all — there is
      // nothing to write against. (Turning sharing OFF does not land here: the
      // row survives as `private`, so its config stays editable.)
      if (!base) return Promise.resolve();

      const uiPatch = typeof patch === 'function' ? patch(base) : patch;
      // Project the patch locally right away, so the control reflects the edit
      // immediately AND the next patch composes on top of this one. This is a
      // UI-only preview — the outgoing network payload is resolved separately
      // below, at send time, against `sendConfigRef` (see its doc comment).
      latestConfigRef.current = mergeShareConfig(base, uiPatch);
      const optimisticConfig = latestConfigRef.current;
      void mutate(
        (current) => (current ? { ...current, shareConfig: optimisticConfig } : current),
        {
          revalidate: false,
        },
      );

      return runWrite(async (generation) => {
        // Resolve the OUTGOING payload now, not at call time: `enqueue`
        // guarantees no earlier queued write's task body is still running by
        // the time this one starts, so `sendConfigRef` already reflects every
        // earlier write's real outcome (advanced on success, rolled back on
        // failure) instead of the optimistic UI projection above, which
        // cannot un-bake a since-failed edit once composed into it.
        //
        // Skip touching the shared ref once the identity generation has moved
        // on (this task belongs to an abandoned identity, per
        // `commitIfCurrent`'s doc): fall
        // back to the call-time `base` this closure already captured, which
        // reproduces the pre-fix behavior for that edge case instead of
        // reading/mutating a ref that now belongs to a different agent.
        const forCurrentIdentity = generationRef.current === generation;
        // `sendConfigRef.current` is only ever `null`/`undefined` in lockstep
        // with `latestConfigRef` (see both refs' reset points above), and
        // `base` already proved non-null via the guard at the top of this
        // callback — so falling back to `base` here also keeps `sendBase`
        // non-null for `patch`'s functional form.
        const sendBase = forCurrentIdentity ? (sendConfigRef.current ?? base) : base;
        const resolved = typeof patch === 'function' ? patch(sendBase) : patch;
        if (forCurrentIdentity) sendConfigRef.current = mergeShareConfig(sendBase, resolved);

        try {
          const updated = await agentShareService.updateShareConfig(agentId, resolved);
          await commitIfCurrent(generation, updated);
        } catch (error) {
          // Roll back this write's contribution so the NEXT queued write's
          // send-time resolution does not see it. Re-check identity rather
          // than reusing `forCurrentIdentity`: it may have changed while the
          // request was in flight, in which case `sendConfigRef` now belongs
          // to a different agent and must be left alone.
          if (generationRef.current === generation) sendConfigRef.current = sendBase;
          // The optimistic projection is dropped by the server re-read that
          // `runWrite` issues for every failed write.
          throw error;
        }
      });
    },
    [agentId, commitIfCurrent, runWrite],
  );

  /**
   * Pause sharing. The row survives as `private`, so nothing local needs
   * invalidating: an edit issued in the same tick (a debounced limit patch
   * flushed on unmount, say) simply queues behind this write and lands on the
   * row it was always meant for.
   */
  const disable = useCallback(
    () =>
      runWrite(async (generation) => {
        const disabled = await agentShareService.disableShare(agentId);
        await commitIfCurrent(generation, disabled);
      }),
    [agentId, commitIfCurrent, runWrite],
  );

  const updateSlug = useCallback(
    (slug: string | null) =>
      runWrite(async (generation) => {
        const updated = await agentShareService.updateSlug(agentId, slug);
        await commitIfCurrent(generation, updated);
      }),
    [agentId, commitIfCurrent, runWrite],
  );

  return { disable, enable, error, isLoading, mutate, share, updateConfig, updateSlug };
};
