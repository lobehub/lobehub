import { useChatStore } from '@/store/chat';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';

/** Whether an agent run is in progress in the artboard's topic. */
export const useAgentRunningInTopic = (topicId: string | null) =>
  useChatStore(
    (s) =>
      !!topicId &&
      Object.values(s.operations).some(
        (op) =>
          op.context.topicId === topicId &&
          op.status === 'running' &&
          AI_RUNTIME_OPERATION_TYPES.includes(op.type),
      ),
  );
