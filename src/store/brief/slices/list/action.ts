import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { briefKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { briefService } from '@/services/brief';
import { taskService } from '@/services/task';
import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('briefList');

type Setter = StoreSetter<BriefStore>;

export const createBriefListSlice = (set: Setter, get: () => BriefStore, _api?: unknown) =>
  new BriefListActionImpl(set, get, _api);

export class BriefListActionImpl {
  readonly #get: () => BriefStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => BriefStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_updateBrief = (id: string, data: Partial<BriefItem>) => {
    const briefs = this.#get().briefs;
    const index = briefs.findIndex((b) => b.id === id);
    if (index === -1) return;

    const updated = [...briefs];
    updated[index] = { ...briefs[index], ...data };
    this.#set({ briefs: updated }, false, n('internal_updateBrief'));
  };

  deleteBrief = async (id: string) => {
    await briefService.delete(id);
    const briefs = this.#get().briefs.filter((b) => b.id !== id);
    this.#set({ briefs }, false, n('deleteBrief'));
  };

  markBriefRead = async (id: string) => {
    await briefService.markRead(id);
    this.internal_updateBrief(id, { readAt: new Date().toISOString() });
  };

  /**
   * "Mark all read" resolves news briefs with the neutral `read` action and drops
   * them from both Zustand and its backing SWR snapshot. Route remounts hydrate
   * Zustand from SWR before revalidation, so the cache write prevents stale briefs
   * from reappearing after navigation.
   */
  resolveBriefsAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;

    const result = await briefService.resolveManyAsRead(ids);
    const resolvedIds = new Set(result.data);
    if (resolvedIds.size === 0) return;

    const { briefs: previous, briefsScope } = this.#get();
    const briefs = previous.filter((b) => !resolvedIds.has(b.id));
    this.#set({ briefs }, false, n('resolveBriefsAsRead'));

    // Write back to the entry this list actually came from, not to whatever
    // scope is live now: on a mid-flight workspace switch the latter would seed
    // the new workspace's cache with the previous one's briefs — the exact leak
    // this slice exists to prevent. An unstamped list belongs to no entry.
    if (briefsScope === undefined) return;
    void mutate(briefKeys.list(true, briefsScope), briefs, { revalidate: false });
  };

  resolveBrief = async (id: string, action?: string, comment?: string) => {
    await briefService.resolve(id, { action, comment });
    this.internal_updateBrief(id, {
      resolvedAction: action,
      resolvedAt: new Date().toISOString(),
    });
  };

  // Free-form feedback from the brief card: resolve the brief with the
  // user's text (so the heartbeat re-arm gate in TaskLifecycle no longer
  // sees an unresolved urgent brief), then re-run the task so the agent
  // picks up `resolvedComment` in its next prompt. Without this, the brief
  // stays unresolved and the task is parked forever in `human-waiting`.
  submitFeedback = async (briefId: string, taskId: string, content: string) => {
    await this.resolveBrief(briefId, 'feedback', content);
    try {
      await taskService.run(taskId);
    } catch (error) {
      // CONFLICT means a run is already in flight (e.g. the user resolved
      // multiple briefs at once) — the in-flight run will read the freshly
      // resolved comment, so the resolve still does its job.
      console.warn('[BriefStore] submitFeedback: task.run failed', error);
    }
  };

  /**
   * `scope` is the identity partition (`${userId}:${workspaceId}`) the caller is
   * rendering. Briefs are per-user AND per-workspace rows, so carrying a list
   * across a scope change hands the user cards whose ids the server can no
   * longer resolve — every action on them 404s, and the tRPC client only logs
   * non-401 failures, so the surface just stops responding. Dropping the bucket
   * the moment the scope changes is what keeps that from happening.
   */
  useFetchBriefs = (isLogin: boolean | undefined, scope: string): SWRResponse<BriefItem[]> => {
    // Effect (not render-time set) because this writes another store; the
    // scope-aware selectors already keep the foreign list off screen in the
    // frame before it runs.
    useEffect(() => {
      const { briefsScope } = this.#get();
      if (briefsScope === undefined || briefsScope === scope) return;

      this.#set(
        { briefs: [], briefsScope: undefined, isBriefsInit: false },
        false,
        n('useFetchBriefs/scopeChanged'),
      );
    }, [scope]);

    return useClientDataSWRWithSync<BriefItem[]>(
      isLogin === true ? briefKeys.list(isLogin, scope) : null,
      async () => {
        const result = await briefService.listUnresolved();
        return result.data as BriefItem[];
      },
      {
        onData: (data) => {
          // A response in flight across a scope switch answers for the previous
          // partition — writing it back would re-seed exactly the unreachable
          // list this hook exists to clear.
          if (getCacheScope() !== scope) return;

          const state = this.#get();
          if (state.isBriefsInit && state.briefsScope === scope && isEqual(state.briefs, data))
            return;

          this.#set(
            { briefs: data, briefsScope: scope, isBriefsInit: true },
            false,
            n('useFetchBriefs/onData'),
          );
        },
      },
    );
  };
}

export type BriefListAction = Pick<BriefListActionImpl, keyof BriefListActionImpl>;
