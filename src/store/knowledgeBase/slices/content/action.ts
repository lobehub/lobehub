import { type StateCreator } from 'zustand/vanilla';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import { useFileStore } from '@/store/file';
import { type KnowledgeBaseStore } from '@/store/knowledgeBase/store';

export interface KnowledgeBaseContentAction {
  addFilesToKnowledgeBase: (knowledgeBaseId: string, ids: string[]) => Promise<void>;
  removeFilesFromKnowledgeBase: (knowledgeBaseId: string, ids: string[]) => Promise<void>;
}

export const createContentSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  KnowledgeBaseContentAction
> = () => ({
  addFilesToKnowledgeBase: async (knowledgeBaseId, ids) => {
    await knowledgeBaseService.addFilesToKnowledgeBase(knowledgeBaseId, ids);

    // Refetch resource list to show updated KB associations
    const fileStore = useFileStore.getState();
    const queryParams = fileStore.queryParams;
    if (queryParams) {
      await fileStore.fetchResources(queryParams);
    }
  },

  removeFilesFromKnowledgeBase: async (knowledgeBaseId, ids) => {
    await knowledgeBaseService.removeFilesFromKnowledgeBase(knowledgeBaseId, ids);

    // Refetch resource list to show updated KB associations
    const fileStore = useFileStore.getState();
    const queryParams = fileStore.queryParams;
    if (queryParams) {
      await fileStore.fetchResources(queryParams);
    }
  },
});
