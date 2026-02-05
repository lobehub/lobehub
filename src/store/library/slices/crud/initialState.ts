import type {KnowledgeBaseItem} from '@/types/knowledgeBase';

export interface KnowledgeBaseState {
  activeKnowledgeBaseId: string | null;
  activeKnowledgeBaseItems: Record<string, KnowledgeBaseItem>;
  initKnowledgeBaseList: boolean;
  knowledgeBaseLoadingIds: string[];
  knowledgeBaseRenamingId?: string | null;
  knowledgeBaseUpdatingId: string | null;
}

export const initialKnowledgeBaseState: KnowledgeBaseState = {
  activeKnowledgeBaseId: null,
  activeKnowledgeBaseItems: {},
  initKnowledgeBaseList: false,
  knowledgeBaseLoadingIds: [],
  knowledgeBaseRenamingId: null,
  knowledgeBaseUpdatingId: null,
};
