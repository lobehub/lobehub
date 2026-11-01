import { type UIChatMessage } from '@lobechat/types';

import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { type ResolvedAgentConfig } from '@/services/chat/mecha';

// Test Constants
export const TEST_IDS = {
  ASSISTANT_MESSAGE_ID: 'test-assistant-message-id',
  FILE_ID: 'test-file-id',
  MESSAGE_ID: 'test-message-id',
  NEW_MESSAGE_ID: 'new-message-id',
  NEW_TOPIC_ID: 'new-topic-id',
  SESSION_ID: 'test-session-id',
  TOPIC_ID: 'test-topic-id',
  USER_MESSAGE_ID: 'test-user-message-id',
} as const;

export const TEST_CONTENT = {
  AI_RESPONSE: 'Test AI response',
  EMPTY: '',
  RAG_QUERY: 'Test RAG query',
  USER_MESSAGE: 'Test user message',
} as const;

// Mock Data Factories
export const createMockMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage => {
  const base: any = {
    content: TEST_CONTENT.USER_MESSAGE,
    createdAt: Date.now(),
    id: TEST_IDS.MESSAGE_ID,
    role: 'user',
    sessionId: TEST_IDS.SESSION_ID,
    topicId: TEST_IDS.TOPIC_ID,
    updatedAt: Date.now(),
  };

  // Merge overrides, preserving all provided properties
  return { ...base, ...overrides } as UIChatMessage;
};

export const createMockMessages = (count: number): UIChatMessage[] =>
  Array.from({ length: count }, (_, i: any) =>
    createMockMessage({
      content: `Message ${i}`,
      id: `msg-${i}`,
    }),
  );

export const createMockAgentConfig = (overrides: any = {}) => ({
  ...DEFAULT_AGENT_CONFIG,
  ...overrides,
});

export const createMockChatConfig = (overrides: any = {}) => ({
  ...DEFAULT_AGENT_CHAT_CONFIG,
  ...overrides,
});

// Mock Store State Factory
export const createMockStoreState = (overrides: any = {}) => ({
  activeAgentId: TEST_IDS.SESSION_ID,
  activeTopicId: TEST_IDS.TOPIC_ID,
  messagesMap: {},
  toolCallingStreamIds: {},
  ...overrides,
});

/**
 * Create a mock ResolvedAgentConfig for testing
 */
export const createMockResolvedAgentConfig = (
  overrides: Partial<ResolvedAgentConfig> = {},
): ResolvedAgentConfig => ({
  agentConfig: createMockAgentConfig(),
  chatConfig: createMockChatConfig(),
  isBuiltinAgent: false,
  plugins: [],
  ...overrides,
});
