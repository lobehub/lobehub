import type { ChatTopic } from '@lobechat/types';
import { resolveToolMode } from '@lobechat/types';

import { resolveAgentConfig } from '@/services/chat/mecha';

export const getSendConversationMode = (agentId: string, topic?: Pick<ChatTopic, 'metadata'>) =>
  topic?.metadata?.conversationMode ??
  (resolveToolMode(resolveAgentConfig({ agentId }).chatConfig) === 'chat' ? 'chat' : 'agent');
