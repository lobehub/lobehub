import { NEWS_BRIEF_TYPES } from '@lobechat/types';
import dayjs from 'dayjs';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
  revalidateReplica,
} from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { goalKeys } from '@/libs/swr/keys';
import { briefService } from '@/services/brief';
import { taskService } from '@/services/task';
import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';
import { goalGraphResource, homeGoalListResource } from '@/store/goal/projection';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  BRIEF_LIST_KEY,
  briefEntity,
  briefListResource,
  briefNewsResource,
  type NewsDay,
  newsDayEntity,
  type NewsDayParams,
} from './projection';

const n = setNamespace('briefList');

export type { NewsDay } from './projection';

/** Sync flags of the unresolved feed, plus the aliases the inbox reads. */
export interface BriefListSyncResult extends ReplicaSyncResult {
  /** A request is in flight and the feed has no value for this scope yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

/** The feed has one entry per scope (the replica partitions by identity), so its params are constant. */
const LIST_PARAMS = {} as Record<string, never>;

/**
 * The digest is read by every Home surface that owns the rail sections; collapse
 * their mounts into one request. Writes, focus and explicit revalidation still
 * refresh as usual.
 */
const NEWS_DEDUPING_INTERVAL = 10_000;

type Setter = StoreSetter<BriefStore>;

export const createBriefListSlice = (set: Setter, get: () => BriefStore, _api?: unknown) =>
  new BriefListActionImpl(set, get, _api);

export class BriefListActionImpl {
  readonly #get: () => BriefStore;
  readonly #briefList;
  readonly #briefNews;
  readonly #briefs;
  readonly #listBriefs;
  readonly #newsBriefs;

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
    this.#briefNews = createReplicaSlice(briefNewsResource, {
      actionPrefix: n('news'),
      entity: newsDayEntity,
      // `day` is the viewer's local `YYYY-MM-DD`; the [start, end) instants are
      // computed here so the server stays timezone-agnostic.
      fetcher: async ({ day }: NewsDayParams): Promise<NewsDay> => {
        const startAt = dayjs(day).startOf('day');
        const result = await briefService.listNewsByDay({
          endAt: startAt.add(1, 'day').toDate(),
          startAt: startAt.toDate(),
        });
        return { day, hasEarlier: result.hasEarlier, news: result.data as BriefItem[] };
      },
      get,
      set,
      stateKey: 'briefNewsReplica',
      view: recordLens<BriefStore, NewsDay>('briefNewsMap'),
    });
    // A news brief is in both the unresolved feed and its day's digest, so a
    // read / resolve / delete lands on both — persisted rows of days not on
    // screen included.
    this.#briefs = linkReplicaEntity<BriefItem>([this.#briefList, this.#briefNews]);
    this.#listBriefs = linkReplicaEntity<BriefItem>([this.#briefList]);
    this.#newsBriefs = linkReplicaEntity<BriefItem>([this.#briefNews]);
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
    const resolvedAt = new Date().toISOString();
    for (const id of result.data) {
      this.#listBriefs.remove(id);
      // The digest keeps resolved briefs (it is a day's record, not a to-do list).
      this.#newsBriefs.update(id, (brief) => ({ ...brief, resolvedAction: 'read', resolvedAt }));
    }
    void this.#briefNews.revalidate();
  };

  resolveBrief = async (id: string, action?: string, comment?: string) => {
    const target = this.#get().briefListMap[BRIEF_LIST_KEY]?.find((brief) => brief.id === id);
    const goal = target?.metadata?.goal;
    await this.#briefs.optimistic(
      id,
      (brief) => ({
        ...brief,
        resolvedAction: action ?? null,
        resolvedAt: new Date().toISOString(),
      }),
      () => briefService.resolve(id, { action, comment }),
    );
    // An urgent news brief is answered from "Needs you", and the day digest it
    // returns to holds its own unresolved copy — refresh it so the handled brief
    // does not come back there as unread once it leaves the unresolved feed.
    if (target && NEWS_BRIEF_TYPES.includes(target.type)) void this.#briefNews.revalidate();
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
   * Day-scoped news digest (`insight` + `result`, resolved included) of the
   * active identity scope. Read it with `briefNewsSelectors.newsDay(day)`: the
   * replica hydrates the persisted day on the first frame and converges on the
   * server in the background.
   */
  useFetchNewsByDay = (enabled: boolean, day: string): ReplicaSyncResult =>
    this.#briefNews.useSync({ day }, { dedupingInterval: NEWS_DEDUPING_INTERVAL, enabled });

  /**
   * Seed the persisted unresolved feed and `day`'s digest before Home commits,
   * so the inbox paints the last confirmed briefs on the first frame instead of
   * a skeleton until the mount-time hydrate lands. Call from a route loader,
   * bounded by a timeout.
   */
  preHydrateInbox = async (day: string): Promise<boolean[]> => {
    const scope = briefListResource.scope.get();
    // The slots may still hold the previous identity's rows; drop them first.
    this.#briefList.ensureScope(scope);
    this.#briefNews.ensureScope(scope);
    return Promise.all([
      this.#briefList.hydrate(LIST_PARAMS, scope),
      this.#briefNews.hydrate({ day }, scope),
    ]);
  };

  /**
   * The unresolved feed of the active scope. Read the rows with
   * `briefListSelectors.briefs`; the replica hydrates the persisted copy on the
   * first frame and converges on the server's head page in the background.
   */
  useFetchBriefs = (isLogin: boolean | undefined): BriefListSyncResult =>
    this.#syncResult(this.#briefList.useSync(LIST_PARAMS, { enabled: isLogin === true }));
}

export type BriefListAction = Pick<BriefListActionImpl, keyof BriefListActionImpl>;
