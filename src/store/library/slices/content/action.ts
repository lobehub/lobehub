import { useFileStore } from '@/store/file';
import { type KnowledgeBaseStore } from '@/store/library/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<KnowledgeBaseStore>;
export const createContentSlice = (set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) =>
  new KnowledgeBaseContentActionImpl(set, get, _api);

export class KnowledgeBaseContentActionImpl {
  constructor(set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  addFilesToKnowledgeBase = async (knowledgeBaseId: string, ids: string[]): Promise<void> => {
    const fileStore = useFileStore.getState();
    await fileStore.addResourcesToKnowledgeBase(knowledgeBaseId, ids);
  };

  removeFilesFromKnowledgeBase = async (knowledgeBaseId: string, ids: string[]): Promise<void> => {
    const fileStore = useFileStore.getState();
    await fileStore.removeResourcesFromKnowledgeBase(knowledgeBaseId, ids);
  };
}

export type KnowledgeBaseContentAction = Pick<
  KnowledgeBaseContentActionImpl,
  keyof KnowledgeBaseContentActionImpl
>;
