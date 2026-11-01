import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { useFileStore } from '@/store/file';
import { RESOURCE_LIST_KEY } from '@/store/file/slices/resource/projection';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { toTreeItemFromResource, TreeActionImpl } from './actions';
import { initialTreeState } from './initialState';
import type { TreeState } from './types';

const createStore: StateCreator<TreeState, [['zustand/devtools', never]]> = (set, get) => ({
  ...initialTreeState,
  ...flattenActions([new TreeActionImpl(set, get)]),
});

const devtools = createDevtools('tree');

export const useTreeStore = createWithEqualityFn<TreeState>()(devtools(createStore), shallow);

// --- Module-level subscription: Explorer → Tree ---
let prevResourceList: unknown[] = [];
let prevQueryParamsRef: unknown = null;
let prevPendingCount = 0;

useFileStore.subscribe((state) => {
  const { resourceList, queryParams } = state;
  // A settled delete leaves `resourceList` as it was (the overlay already
  // removed the row); the drop in pending overlays is what confirms it.
  const pendingCount = state.resourceListReplica?.entries[RESOURCE_LIST_KEY]?.pending.length ?? 0;
  if (
    resourceList === prevResourceList &&
    queryParams === prevQueryParamsRef &&
    pendingCount === prevPendingCount
  )
    return;
  prevResourceList = resourceList;
  prevQueryParamsRef = queryParams;
  prevPendingCount = pendingCount;

  const { knowledgeBaseId } = useTreeStore.getState();
  if (!queryParams || queryParams.libraryId !== knowledgeBaseId) return;
  if (queryParams.q) return;

  // `toTreeItemFromResource` drops `_optimistic`, so decide here whether the
  // list is server-confirmed: only then may the tree persist it.
  const confirmed = pendingCount === 0 && !resourceList.some((item) => item._optimistic);
  const parentKey = queryParams.parentId ?? '';
  useTreeStore.getState().reconcile(
    parentKey,
    resourceList.map((item) => toTreeItemFromResource(item)),
    { confirmed },
  );
});
