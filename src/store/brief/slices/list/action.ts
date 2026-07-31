import dayjs from 'dayjs';
import { type SWRResponse } from 'swr';

import { getClientDataStoreState } from '@/client-data';
import { useClientDataSWR } from '@/libs/swr';
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
    const scope = getCacheScope();
    const observedAt = Date.now();
    await briefService.delete(id);
    getClientDataStoreState().deleteBriefEntity(scope, id, observedAt);

    const previous = this.#get().briefs;
    const briefs = previous.filter((b) => b.id !== id);
    // Nothing removed — the brief was already gone, or the list has since been
    // replaced by another scope's (a workspace switch while the request was in
    // flight). Either way, writing an identical list only churns subscribers.
    if (briefs.length === previous.length) return;

    this.#set({ briefs }, false, n('deleteBrief'));
  };

  markBriefRead = async (id: string) => {
    const scope = getCacheScope();
    const observedAt = Date.now();
    const result = await briefService.markRead(id);
    const readAt = result.data.readAt ?? new Date().toISOString();
    this.internal_updateBrief(id, { readAt });
    getClientDataStoreState().updateBriefReadState(scope, id, readAt, observedAt);
  };

  /**
   * "Mark all read" resolves news briefs with the neutral `read` action and drops
   * them from both the legacy Zustand projection and the canonical Home index.
   */
  resolveBriefsAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;

    // Capture the scope these ids belong to *before* awaiting — a workspace
    // switch mid-request must not land the resolution in the next partition.
    const scope = getCacheScope();
    const observedAt = Date.now();
    const result = await briefService.resolveManyAsRead(ids);
    const resolvedIds = new Set(result.data);
    if (resolvedIds.size === 0) return;

    getClientDataStoreState().resolveBriefEntitiesAsRead(
      scope,
      [...resolvedIds],
      new Date().toISOString(),
      observedAt,
    );

    // The legacy projection is patched only while it still belongs to this
    // scope: the switch already cleared the bucket, so a mismatch means there
    // is nothing of ours left to patch.
    const state = this.#get();
    if (state.briefsScope !== scope) return;

    const briefs = state.briefs.filter((b) => !resolvedIds.has(b.id));
    this.#set({ briefs }, false, n('resolveBriefsAsRead'));
  };

  resolveBrief = async (id: string, action?: string, comment?: string) => {
    const scope = getCacheScope();
    const observedAt = Date.now();
    const result = await briefService.resolve(id, { action, comment });
    const resolvedAction = result.data.resolvedAction ?? action ?? null;
    const resolvedAt = result.data.resolvedAt ?? new Date().toISOString();
    const resolvedComment = result.data.resolvedComment ?? comment ?? null;
    this.internal_updateBrief(id, {
      resolvedAction,
      resolvedAt,
      resolvedComment,
    });
    getClientDataStoreState().updateBriefResolution(
      scope,
      id,
      {
        resolvedAction,
        resolvedAt,
        resolvedComment,
      },
      observedAt,
    );
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
}

export type BriefListAction = Pick<BriefListActionImpl, keyof BriefListActionImpl>;
