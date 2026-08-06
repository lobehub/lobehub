import dayjs from 'dayjs';
import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR, useClientDataSWRWithSync } from '@/libs/swr';
import { briefKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { briefService } from '@/services/brief';
import { taskService } from '@/services/task';
import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('briefList');

export interface NewsDay {
  /**
   * The local day (`YYYY-MM-DD`) this payload belongs to. Carried in the data so
   * consumers rendering with `keepPreviousData` can label/gate from the day
   * actually shown instead of the day being fetched — otherwise a slow page
   * flip shows the new day's title over the old day's briefs.
   */
  day: string;
  /** Any news brief older than this day exists — the day pager's "older" arrow. */
  hasEarlier: boolean;
  news: BriefItem[];
}

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

    const previous = this.#get().briefs;
    const briefs = previous.filter((b) => b.id !== id);
    // Nothing removed — the brief was already gone, or the list has since been
    // replaced by another scope's (a workspace switch while the request was in
    // flight). Either way, writing an identical list only churns subscribers.
    if (briefs.length === previous.length) return;

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

    // Capture the scope these ids belong to *before* awaiting. Unlike the
    // id-keyed mutations above, this one rewrites the whole list and patches an
    // SWR entry, so a workspace switch mid-request would splice the previous
    // partition's briefs into the next one's bucket and cache key — the exact
    // leak this slice exists to prevent.
    const scope = this.#get().briefsScope;

    const result = await briefService.resolveManyAsRead(ids);
    const resolvedIds = new Set(result.data);
    if (resolvedIds.size === 0) return;

    const state = this.#get();
    // Unstamped, or the scope moved while the request was in flight: the switch
    // already cleared the bucket, so there is nothing of ours left to patch.
    if (scope === undefined || state.briefsScope !== scope) return;

    const briefs = state.briefs.filter((b) => !resolvedIds.has(b.id));
    this.#set({ briefs }, false, n('resolveBriefsAsRead'));
    void mutate(briefKeys.list(true, scope), briefs, { revalidate: false });
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
   * Day-scoped news digest (`insight` + `result`, resolved included). Lives in
   * SWR only — no zustand bucket: the key already partitions by identity scope
   * and day, the list is read-mostly, and the one mutation that touches it
   * (mark-all-read) revalidates through the returned SWR handle. `day` is the
   * viewer's local `YYYY-MM-DD`; the [start, end) instants are computed here so
   * the server stays timezone-agnostic. `keepPreviousData` keeps the section
   * stable while the user pages between days.
   */
  useFetchNewsByDay = (enabled: boolean, scope: string, day: string): SWRResponse<NewsDay> =>
    useClientDataSWR<NewsDay>(
      enabled ? briefKeys.news(true, scope, day) : null,
      async () => {
        const startAt = dayjs(day).startOf('day');
        const result = await briefService.listNewsByDay({
          endAt: startAt.add(1, 'day').toDate(),
          startAt: startAt.toDate(),
        });
        return { day, hasEarlier: result.hasEarlier, news: result.data as BriefItem[] };
      },
      { keepPreviousData: true },
    );

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
