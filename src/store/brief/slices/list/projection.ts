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
