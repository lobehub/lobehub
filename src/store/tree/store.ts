import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { useFileStore } from '@/store/file';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { toTreeItem, TreeActionImpl } from './actions';
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

useFileStore.subscribe((state) => {
  const { resourceList, queryParams } = state;
  if (resourceList === prevResourceList && queryParams === prevQueryParamsRef) return;
  prevResourceList = resourceList;
  prevQueryParamsRef = queryParams;

  const { knowledgeBaseId } = useTreeStore.getState();
  if (!queryParams || queryParams.libraryId !== knowledgeBaseId) return;
  if (queryParams.q) return;

  const parentKey = queryParams.parentId ?? '';
  useTreeStore.getState().reconcile(
    parentKey,
    resourceList.map((item) =>
      toTreeItem({
        fileType: item.fileType,
        id: item.id,
        metadata: item.metadata,
        name: item.name,
        slug: item.slug,
        sourceType: item.sourceType,
        url: item.url,
      }),
    ),
  );
});
