import { useKnowledgeBaseStore } from '@/store/knowledgeBase';

export const useKnowledgeBaseItem = (id: string) => {
  const useFetchKnowledgeBaseItem = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseItem);

  return useFetchKnowledgeBaseItem(id);
};
