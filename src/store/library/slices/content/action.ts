import { type StateCreator } from 'zustand/vanilla';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import { revalidateResources } from '@/store/file/slices/resource/hooks';
import { type KnowledgeBaseStore } from '@/store/library/store';

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

    // Revalidate resource list to show updated KB associations
    await revalidateResources();
  },

  removeFilesFromKnowledgeBase: async (knowledgeBaseId, ids) => {
    await knowledgeBaseService.removeFilesFromKnowledgeBase(knowledgeBaseId, ids);

    // Revalidate resource list to show updated KB associations
    await revalidateResources();
  },
});
