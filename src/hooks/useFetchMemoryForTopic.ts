import { useUserMemoryStore } from '@/store/userMemory';

export const useFetchTopicMemories = (topicId?: string | null) => {
  const useFetchMemoriesForTopic = useUserMemoryStore((s) => s.useFetchMemoriesForTopic);

  useFetchMemoriesForTopic(topicId);
};
