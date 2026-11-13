import { artboardService } from '@/services/artboard';
import { useChatStore } from '@/store/chat';

export interface BoardConversation {
  agentId: string;
  topicId: string;
}

export const resolveBoardConversation = async (
  topicId: string | null,
): Promise<BoardConversation | null> => {
  if (!topicId) return null;
  const topic = await artboardService.getConversation(topicId);
  return topic?.agentId ? { agentId: topic.agentId, topicId } : null;
};

export const sendToBoardConversation = async (
  topicId: string | null,
  message: string,
): Promise<'noConversation' | 'sent'> => {
  const context = await resolveBoardConversation(topicId);
  if (!context) return 'noConversation';
  await useChatStore.getState().sendMessage({ context, inputEditor: null, message });
  return 'sent';
};
