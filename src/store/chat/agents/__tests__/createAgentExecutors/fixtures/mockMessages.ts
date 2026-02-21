import { type UIChatMessage } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

/**
 * Create a mock assistant message
 */
export const createAssistantMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage => {
  return {
    content: 'I am an AI assistant.',
    createdAt: Date.now(),
    id: `msg_${nanoid()}`,
    model: 'gpt-4',
    provider: 'openai',
    role: 'assistant',
    updatedAt: Date.now(),
    ...overrides,
  } as UIChatMessage;
};

/**
 * Create a mock user message
 */
export const createUserMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage => {
  return {
    content: 'Hello, AI!',
    createdAt: Date.now(),
    id: `msg_${nanoid()}`,
    role: 'user',
    updatedAt: Date.now(),
    ...overrides,
  } as UIChatMessage;
};

/**
 * Create a mock tool message
 */
export const createToolMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage => {
  return {
    content: '',
    createdAt: Date.now(),
    id: `msg_${nanoid()}`,
    plugin: {
      apiName: 'search',
      arguments: JSON.stringify({ query: 'test' }),
      identifier: 'lobe-web-browsing',
      type: 'default',
    },
    role: 'tool',
    tool_call_id: `tool_call_${nanoid()}`,
    updatedAt: Date.now(),
    ...overrides,
  } as UIChatMessage;
};

/**
 * Create a mock tool message with pending intervention
 */
export const createPendingToolMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage => {
  return createToolMessage({
    pluginIntervention: { status: 'pending' },
    ...overrides,
  });
};

/**
 * Create a mock tool message with aborted intervention
 */
export const createAbortedToolMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage => {
  return createToolMessage({
    content: 'Tool execution was cancelled by user.',
    pluginIntervention: { status: 'aborted' },
    ...overrides,
  });
};

/**
 * Create a conversation history
 */
export const createConversationHistory = (messageCount: number = 3): UIChatMessage[] => {
  const messages: UIChatMessage[] = [];

  for (let i = 0; i < messageCount; i++) {
    if (i % 2 === 0) {
      messages.push(createUserMessage({ content: `User message ${i + 1}` }));
    } else {
      messages.push(createAssistantMessage({ content: `Assistant response ${i + 1}` }));
    }
  }

  return messages;
};
