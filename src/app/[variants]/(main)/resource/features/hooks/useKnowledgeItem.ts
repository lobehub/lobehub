import { useKnowledgeBaseStore } from '@/store/library';

export const useKnowledgeBaseItem = (id: string) => {
  const useFetchKnowledgeBaseItem = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseItem);

  return useFetchKnowledgeBaseItem(id);
};
