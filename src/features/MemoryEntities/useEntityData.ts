import { useMemo } from 'react';

import { memoryCRUDService } from '@/services/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';
import { memoryListKey } from '@/store/userMemory/utils/replica';
import { LayersEnum } from '@/types/userMemory';

import { fromActivityRow, fromContextRow, linkedEntityOf, mergeById, uniqueById } from './adapt';
import { linkByNames } from './link';

/** The backend's page cap. One page covers the activities of ~99% of users. */
export const ENTITY_PAGE_SIZE = 100;

/** Entry key of the unfiltered context list in the memory store. */
const ALL_CONTEXTS = memoryListKey({});

/**
 * The entity pages read the memory store's replica-backed lists: contexts (one entry per
 * search, offset paging, optimistic delete with the offset repair) and activities, plus the
 * memory detail replica for a deep link outside the loaded pages. Edits patch every loaded and
 * persisted query, so the Memory portal and other memory pages see them too.
 */
export const useEntityData = (selectedId?: string) => {
  const useFetchContexts = useUserMemoryStore((s) => s.useFetchContexts);
  const useFetchActivities = useUserMemoryStore((s) => s.useFetchActivities);
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);
  const loadMoreContexts = useUserMemoryStore((s) => s.loadMoreContexts);
  const deleteContext = useUserMemoryStore((s) => s.deleteContext);
  const updateContextEntity = useUserMemoryStore((s) => s.internal_updateContextEntity);

  const contexts = useFetchContexts({ pageSize: ENTITY_PAGE_SIZE });
  const activityList = useFetchActivities({ pageSize: ENTITY_PAGE_SIZE });
  // Read the unfiltered entry itself: the store's flat mirrors follow whichever query is
  // active, and a search in the list makes its own query active.
  const listState = useUserMemoryStore((s) => s.contextListEntries[ALL_CONTEXTS]);

  const contextRows = contexts.data?.items;
  const activityRows = activityList.data?.items;
  const entities = useMemo(
    () => uniqueById((contextRows ?? []).map(fromContextRow)),
    [contextRows],
  );
  const activities = useMemo(
    () => uniqueById((activityRows ?? []).map(fromActivityRow)),
    [activityRows],
  );
  const isLoading = (!contextRows && !contexts.error) || (!activityRows && !activityList.error);

  // A deep link (e.g. "open in memory" from a chat) may point past the loaded pages.
  const loaded = entities.some((e) => e.id === selectedId);
  const detail = useFetchMemoryDetail(
    !isLoading && !loaded && selectedId ? selectedId : null,
    LayersEnum.Context,
  );
  const linked = useMemo(
    () => (selectedId ? linkedEntityOf(detail.data, selectedId) : undefined),
    [detail.data, selectedId],
  );
  // The deep-linked page needs its timeline too, so it joins the loaded ones for linking.
  const links = useMemo(
    () =>
      contextRows && activityRows
        ? linkByNames(linked ? mergeById(entities, [linked]) : entities, activities)
        : undefined,
    [activities, activityRows, contextRows, entities, linked],
  );

  /** Rows in the lists are patched in place; a deep-linked row is refetched. */
  const afterEdit = async (id: string) => {
    if (linked?.id === id) await detail.mutate();
  };

  const updateNow = async (id: string, description: string) => {
    await memoryCRUDService.updateContext(id, { description });
    updateContextEntity(id, (row) => ({ ...row, description, updatedAt: new Date() }));
    await afterEdit(id);
  };

  const setStatus = async (id: string, currentStatus: string) => {
    await memoryCRUDService.updateContext(id, { currentStatus });
    updateContextEntity(id, (row) => ({ ...row, currentStatus }));
    await afterEdit(id);
  };

  /** Optimistic; rejects (after rolling back) when the server refuses. */
  const remove = (id: string) => deleteContext(id);

  return {
    activities,
    entities,
    error: contexts.error,
    /** The unfiltered list has pages not loaded yet. */
    hasMore: !!listState?.hasMore,
    isLoading,
    isLoadingMore: !!listState?.isLoadingMore,
    linked,
    links,
    loadMore: loadMoreContexts,
    loadMoreError: listState?.loadMoreError,
    remove,
    retry: () => {
      void contexts.mutate();
      void activityList.mutate();
    },
    setStatus,
    total: listState?.total ?? entities.length,
    updateNow,
  };
};

export type EntityDataApi = ReturnType<typeof useEntityData>;

/**
 * Server-side search through the context list's own query entry. Its rows are shown as matches
 * as they are: the server also searches fields the list does not hold (status, parent details).
 * An empty keyword reads the unfiltered entry, so the search query only becomes the store's
 * active one while a keyword is typed.
 */
export const useRemoteContextSearch = (q: string | undefined) => {
  const useFetchContexts = useUserMemoryStore((s) => s.useFetchContexts);
  const { data } = useFetchContexts({ pageSize: ENTITY_PAGE_SIZE, q });
  const rows = q ? data?.items : undefined;
  return useMemo(() => (rows ? uniqueById(rows.map(fromContextRow)) : undefined), [rows]);
};
