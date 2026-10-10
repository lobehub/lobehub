import dayjs from 'dayjs';
import { type SWRResponse } from 'swr';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
  revalidateReplica,
} from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { briefKeys, goalKeys } from '@/libs/swr/keys';
import { briefService } from '@/services/brief';
import { taskService } from '@/services/task';
import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';
import { goalGraphResource, homeGoalListResource } from '@/store/goal/projection';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { BRIEF_LIST_KEY, briefEntity, briefListResource } from './projection';

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

/** Sync flags of the unresolved feed, plus the aliases the inbox reads. */
export interface BriefListSyncResult extends ReplicaSyncResult {
  /** A request is in flight and the feed has no value for this scope yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

/** The feed has one entry per scope (the replica partitions by identity), so its params are constant. */
const LIST_PARAMS = {} as Record<string, never>;

type Setter = StoreSetter<BriefStore>;

export const createBriefListSlice = (set: Setter, get: () => BriefStore, _api?: unknown) =>
  new BriefListActionImpl(set, get, _api);

export class BriefListActionImpl {
  readonly #get: () => BriefStore;
  readonly #briefList;
  readonly #briefs;

  constructor(set: Setter, get: () => BriefStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#briefList = createReplicaSlice(briefListResource, {
      actionPrefix: n('list'),
      entity: briefEntity,
      fetcher: () => briefService.listUnresolved(),
      get,
      // The server row keeps `actions` as a json column (`unknown`); the card
      // narrows it to `BriefAction[]`, so the view adopts the client `BriefItem`.
      merge: (response) => response.data as unknown as BriefItem[],
      set,
      stateKey: 'briefListReplica',
      view: recordLens<BriefStore, BriefItem[]>('briefListMap'),
    });
    // Every brief mutation runs through the entity link: the optimistic overlay
    // applies right away, a failed write rolls back to the confirmed base, and a
    // confirmed write reaches the persisted row too — so a reload never hydrates
    // a value the server has already moved past.
    this.#briefs = linkReplicaEntity<BriefItem>([this.#briefList]);
  }

  #syncResult = (sync: ReplicaSyncResult): BriefListSyncResult => ({
    ...sync,
    isLoading: sync.isValidating && this.#get().briefListMap[BRIEF_LIST_KEY] === undefined,
    mutate: sync.revalidate,
  });

  /** Show the read state at once; the server confirms in the background. */
  markBriefRead = async (id: string) => {
    await this.#briefs.optimistic(
      id,
      (brief) => ({ ...brief, readAt: new Date().toISOString() }),
      () => briefService.markRead(id),
    );
  };

  deleteBrief = async (id: string) => {
    await this.#briefs.optimistic(id, 'remove', () => briefService.delete(id));
  };

  /**
   * "Mark all read" resolves news briefs with the neutral `read` action and
   * drops them from the unresolved feed. The removal is written to the store
   * and its persisted row, so a route remount hydrates the already-cleared list
   * instead of resurrecting the briefs.
   */
  resolveBriefsAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;

    const result = await briefService.resolveManyAsRead(ids);
    for (const id of result.data) this.#briefs.remove(id);
  };

  resolveBrief = async (id: string, action?: string, comment?: string) => {
    const goal = this.#get().briefListMap[BRIEF_LIST_KEY]?.find((brief) => brief.id === id)
      ?.metadata?.goal;
    await this.#briefs.optimistic(
      id,
      (brief) => ({
        ...brief,
        resolvedAction: action ?? null,
        resolvedAt: new Date().toISOString(),
      }),
      () => briefService.resolve(id, { action, comment }),
    );
    // A goal brief answered the goal itself: the island and the goal views
    // asking the same question have to drop it too.
    if (goal)
      void Promise.all([
        mutate((key) => Array.isArray(key) && key[0] === goalKeys.pendingForIsland()[0]),
        // The goal's own reads are replicas now: their sync entries live outside
        // the `goal:` / `task:` SWR cache, so they are refreshed through the
        // resource rather than a key prefix match.
        revalidateReplica(homeGoalListResource),
        revalidateReplica(goalGraphResource, goal.goalId),
      ]);
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
   * The unresolved feed of the active scope. Read the rows with
   * `briefListSelectors.briefs`; the replica hydrates the persisted copy on the
   * first frame and converges on the server's head page in the background.
   */
  useFetchBriefs = (isLogin: boolean | undefined): BriefListSyncResult =>
    this.#syncResult(this.#briefList.useSync(LIST_PARAMS, { enabled: isLogin === true }));
}

export type BriefListAction = Pick<BriefListActionImpl, keyof BriefListActionImpl>;
