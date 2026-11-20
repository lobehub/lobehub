import type { ChatMessageError } from '@lobechat/types';

/**
 * Everything the error card knows about the failed message, handed to a
 * deployment that can act on it (for example by opening a support channel).
 */
export interface ChatErrorSupportActionProps {
  agentId?: string;
  error?: ChatMessageError | null;
  groupId?: string;
  messageId: string;
  model?: string;
  provider?: string;
  threadId?: string;
  topicId?: string;
  traceId?: string;
}

/** Rendered beside the error card's retry button. Nothing by default. */
export const ChatErrorSupportAction = (_props: ChatErrorSupportActionProps) => null;
