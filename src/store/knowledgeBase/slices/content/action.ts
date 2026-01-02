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
    await useFileStore.getState().refreshFileList();
  },

  removeFilesFromKnowledgeBase: async (knowledgeBaseId, ids) => {
    await knowledgeBaseService.removeFilesFromKnowledgeBase(knowledgeBaseId, ids);
    await useFileStore.getState().refreshFileList();
  },
});
