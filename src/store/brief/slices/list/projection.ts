import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';
import type { briefService } from '@/services/brief';
import type { BriefItem } from '@/store/brief/types';

type BriefListResponse = Awaited<ReturnType<typeof briefService.listUnresolved>>;

/**
 * The unresolved feed holds every open brief of the active identity scope, so
 * the list needs exactly one entry per scope. Briefs are per-user AND
 * per-workspace rows: a list carried across a scope change holds ids the new
 * scope cannot resolve, and every action on it fails silently (the tRPC client
 * only logs non-401 failures). Partitioning by the replica's identity scope —
 * instead of a per-scope key — is what keeps that list off screen: the replica
 * clears the view before paint on a scope switch, and the feed paints its
 * skeleton until the new scope's head page lands.
 */
export const BRIEF_LIST_KEY = 'unresolved';

/**
 * The unresolved brief feed of the active scope. Persisted to IndexedDB so a
 * reload / revisit paints the last confirmed list on the first frame, then
 * converges on the server's head page in the background.
 */
export const briefListResource = defineReplica<
  Record<string, never>,
  BriefItem[],
  BriefListResponse
>({
  key: () => BRIEF_LIST_KEY,
  name: 'briefList',
  storage: 'indexedDB',
  version: 1,
});

/** Briefs are addressed by `briefs.id` — the row's own id. */
export const briefEntity: ReplicaEntityAdapter<BriefItem[], BriefItem> = arrayEntity<BriefItem>(
  (brief) => brief.id,
);

export interface NewsDay {
  /**
   * The local day (`YYYY-MM-DD`) this payload belongs to. Carried in the data so
   * a consumer still showing the previous day while the next one loads can
   * label/gate from the day actually shown instead of the day being fetched.
   */
  day: string;
  /** Any news brief older than this day exists — the day pager's "older" arrow. */
  hasEarlier: boolean;
  news: BriefItem[];
}

export interface NewsDayParams {
  /** The viewer's local day, `YYYY-MM-DD`. */
  day: string;
}

/**
 * The day-scoped news digest (`insight` + `result`, resolved included), one
 * entry per local day of the active identity scope. Persisted so a reload
 * paints the last confirmed digest on the first frame; only the most recently
 * viewed days are kept — paging further back is rare and refetches.
 */
export const briefNewsResource = defineReplica<NewsDayParams, NewsDay>({
  key: ({ day }) => day,
  name: 'briefNews',
  persist: { maxEntries: 7 },
  storage: 'indexedDB',
  version: 1,
});

/** A news brief lives in `NewsDay.news`, addressed by `briefs.id`. */
export const newsDayEntity: ReplicaEntityAdapter<NewsDay, BriefItem> = {
  has: (data, id) => briefEntity.has(data.news, id),
  map: (data, id, fn) => {
    const news = briefEntity.map(data.news, id, fn);
    return news === data.news || news === undefined ? data : { ...data, news };
  },
};
