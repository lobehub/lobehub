import { useChatStore } from '@/store/chat';

export const useAgentConversationCoordinate = () =>
  useChatStore(
    (state) =>
      [state.activeAgentId, state.activeTopicId ?? null, state.activeThreadId ?? null] as const,
  );
