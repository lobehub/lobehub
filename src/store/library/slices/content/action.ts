import { knowledgeBaseService } from '@/services/knowledgeBase';
import { revalidateResources } from '@/store/file/slices/resource/hooks';
import { type KnowledgeBaseStore } from '@/store/library/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<KnowledgeBaseStore>;
export const createContentSlice = (set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) =>
  new KnowledgeBaseContentActionImpl(set, get, _api);

export class KnowledgeBaseContentActionImpl {
  readonly #get: () => KnowledgeBaseStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addFilesToKnowledgeBase = async (knowledgeBaseId: string, ids: string[]): Promise<void> => {
    await knowledgeBaseService.addFilesToKnowledgeBase(knowledgeBaseId, ids);

    // Revalidate resource list to show updated KB associations
    await revalidateResources();
  };

  removeFilesFromKnowledgeBase = async (knowledgeBaseId: string, ids: string[]): Promise<void> => {
    await knowledgeBaseService.removeFilesFromKnowledgeBase(knowledgeBaseId, ids);

    // Revalidate resource list to show updated KB associations
    await revalidateResources();
  };
}

export type KnowledgeBaseContentAction = Pick<
  KnowledgeBaseContentActionImpl,
  keyof KnowledgeBaseContentActionImpl
>;
