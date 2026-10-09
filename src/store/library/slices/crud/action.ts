import {
  arrayEntity,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
  singleEntity,
} from '@/libs/replica';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import type { KnowledgeBaseStore } from '@/store/library/store';
import type { StoreSetter } from '@/store/types';
import type { CreateKnowledgeBaseParams, KnowledgeBaseItem } from '@/types/knowledgeBase';

import {
  KNOWLEDGE_BASE_LIST_ALL_KEY,
  knowledgeBaseItemResource,
  knowledgeBaseListResource,
  type KnowledgeBaseVisibility,
} from './projection';

type Setter = StoreSetter<KnowledgeBaseStore>;
export const createCrudSlice = (set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) =>
  new KnowledgeBaseCrudActionImpl(set, get, _api);

/**
 * The knowledge-base domain's read + write slice, on top of two local-first
 * replicas:
 *
 * - `knowledgeBaseList` is the one list per visibility surface
 *   (`knowledgeBaseListMap[all|private|public]`). It hydrates from IndexedDB,
 *   revalidates over the network and is the only writer of the view.
 * - `knowledgeBaseItem` is the by-id projection (`knowledgeBaseDetailMap[id]`)
 *   for a KB that is not in the loaded list (route layout, permission page).
 *
 * Both hold copies of the same KB, so they are linked: a rename or a delete
 * fans out to every loaded copy (and to the persisted rows of entries that are
 * not loaded). Read the values through `knowledgeBaseSelectors`; the two
 * `useFetch*` hooks only orchestrate fetching and return flags.
 */
export class KnowledgeBaseCrudActionImpl {
  readonly #get: () => KnowledgeBaseStore;
  readonly #kbEntity;
  readonly #kbItem;
  readonly #kbList;
  readonly #set: Setter;

  constructor(set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;

    this.#kbList = createReplicaSlice(knowledgeBaseListResource, {
      actionPrefix: 'knowledgeBaseList',
      entity: arrayEntity<KnowledgeBaseItem>((kb) => kb.id),
      get,
      set,
      stateKey: 'knowledgeBaseListReplica',
      view: recordLens<KnowledgeBaseStore, KnowledgeBaseItem[]>('knowledgeBaseListMap'),
    });
    this.#kbItem = createReplicaSlice(knowledgeBaseItemResource, {
      actionPrefix: 'knowledgeBaseItem',
      // The value IS the KB, so entity-level writes (rename, delete) find and
      // map it through this adapter.
      entity: singleEntity<KnowledgeBaseItem>((kb) => kb.id),
      fetcher: async (id) => {
        const item = await knowledgeBaseService.getKnowledgeBaseById(id);
        return item ?? undefined;
      },
      get,
      // A defined response replaces the cached detail. A miss (`undefined`)
      // keeps the cached row here and is cleared in `useFetchKnowledgeBaseItem`
      // once it is known to be authoritative, so a KB deleted on another device
      // does not stay painted on a resolved detail route.
      merge: (incoming) => incoming,
      set,
      stateKey: 'knowledgeBaseDetailReplica',
      view: recordLens<KnowledgeBaseStore, KnowledgeBaseItem>('knowledgeBaseDetailMap'),
    });
    // The same KB lives in the list surfaces and in the by-id projection.
    this.#kbEntity = linkReplicaEntity<KnowledgeBaseItem>([this.#kbList, this.#kbItem]);
  }

  // ---- reads -------------------------------------------------------------

  /**
   * Fetch orchestration for one KB by id. Hydrates the persisted projection,
   * then revalidates; the row lands in `knowledgeBaseDetailMap[id]` and is read
   * through `knowledgeBaseSelectors.getKnowledgeBaseById`.
   */
  useFetchKnowledgeBaseItem = (id: string): ReplicaSyncResult =>
    this.#kbItem.useSync(id || null, {
      onSuccess: (item) => {
        if (!item) {
          // An authoritative miss: the fetch succeeded but the server no longer
          // has this KB. Drop the persisted detail so `useKnowledgeBaseItem`
          // stops returning the stale row and the route resolves to
          // `<NotFound />` instead of a resolved-but-gone KB.
          if (id) this.#kbItem.remove(id);

          return;
        }

        this.#set({ activeKnowledgeBaseId: id }, false, 'knowledgeBase/itemActive');
      },
    });

  /**
   * Fetch orchestration for one KB list surface. The rows land in
   * `knowledgeBaseListMap[visibility ?? 'all']` — read them through
   * `knowledgeBaseSelectors.getKnowledgeBaseList`.
   */
  useFetchKnowledgeBaseList = (visibility?: KnowledgeBaseVisibility): ReplicaSyncResult =>
    this.#kbList.useSync({ visibility });

  // ---- writes ------------------------------------------------------------

  createNewKnowledgeBase = async (params: CreateKnowledgeBaseParams): Promise<string> => {
    const id = await knowledgeBaseService.createKnowledgeBase(params);

    await this.#get().refreshKnowledgeBaseList();

    return id;
  };

  internal_toggleKnowledgeBaseLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { knowledgeBaseLoadingIds: [...state.knowledgeBaseLoadingIds, id] };

        return { knowledgeBaseLoadingIds: state.knowledgeBaseLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleKnowledgeBaseLoading',
    );
  };

  /**
   * Revalidate every list surface (unfiltered / private / workspace) so a
   * mutation is reflected wherever the KB is currently rendered. The sidebar
   * shows one visibility at a time while the switcher and the quick-access row
   * read the unfiltered list, so all three may be on screen.
   */
  refreshKnowledgeBaseList = async (): Promise<void> => {
    await Promise.all([
      this.#kbList.revalidate(KNOWLEDGE_BASE_LIST_ALL_KEY),
      this.#kbList.revalidate('private'),
      this.#kbList.revalidate('public'),
    ]);
  };

  removeKnowledgeBase = async (id: string): Promise<void> => {
    // One optimistic removal across every loaded list surface; a failed delete
    // rolls them all back together.
    await this.#kbEntity.optimistic(id, 'remove', () =>
      knowledgeBaseService.deleteKnowledgeBase(id),
    );

    await this.#get().refreshKnowledgeBaseList();
  };

  publishKnowledgeBaseToWorkspace = async (id: string): Promise<void> => {
    await knowledgeBaseService.publishKnowledgeBaseToWorkspace(id);

    // The row hops from the private surface into the workspace one.
    await this.#get().refreshKnowledgeBaseList();
  };

  setKnowledgeBaseVisibility = async (
    id: string,
    visibility: 'private' | 'public',
  ): Promise<void> => {
    await knowledgeBaseService.setKnowledgeBaseVisibility(id, visibility);

    await this.#get().refreshKnowledgeBaseList();
  };

  updateKnowledgeBase = async (id: string, value: CreateKnowledgeBaseParams): Promise<void> => {
    this.#get().internal_toggleKnowledgeBaseLoading(id, true);
    try {
      // Show the new name / description in every loaded copy at once, then
      // persist; a failed sync rolls every copy back to the KB it had before.
      await this.#kbEntity.optimistic(
        id,
        (kb) => ({ ...kb, ...value }),
        () => knowledgeBaseService.updateKnowledgeBaseList(id, value),
      );

      await this.#get().refreshKnowledgeBaseList();
    } finally {
      this.#get().internal_toggleKnowledgeBaseLoading(id, false);
    }
  };
}

export type KnowledgeBaseCrudAction = Pick<
  KnowledgeBaseCrudActionImpl,
  keyof KnowledgeBaseCrudActionImpl
>;
