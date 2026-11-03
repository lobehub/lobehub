import { useChatStore } from '@/store/chat';

export const useFetchThreads = (activeTopicId?: string) => {
  const [useFetchThreads] = useChatStore((s) => [s.useFetchThreads]);

  useFetchThreads(true, activeTopicId);
};
