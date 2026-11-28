import type { ChatTopic, UIChatMessage } from '@lobechat/types';
import { resolveToolMode } from '@lobechat/types';

import { resolveAgentConfig } from '@/services/chat/mecha';

export const getSendConversationMode = (
  agentId: string,
  topic?: Pick<ChatTopic, 'metadata'>,
  history: Pick<UIChatMessage, 'role' | 'metadata'>[] = [],
) =>
  topic?.metadata?.conversationMode ??
  history.findLast((message) => message.role === 'user' && message.metadata?.conversationMode)
    ?.metadata?.conversationMode ??
  (resolveToolMode(resolveAgentConfig({ agentId }).chatConfig) === 'chat' ? 'chat' : 'agent');
