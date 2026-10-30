import type { ContextSelection, MessageMetadata } from '@lobechat/types';
import { COMPOSER_USER_MESSAGE_METADATA_KEYS } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiChatService } from '@/services/aiChat';
import { getSessionStoreState } from '@/store/session';

import { useChatStore } from '../../../../store';
import { createMockAgentConfig, createMockMessage, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } } },
}));

const context = { agentId: TEST_IDS.SESSION_ID, threadId: null, topicId: TEST_IDS.TOPIC_ID };

const quote = (content: string): ContextSelection => ({
  content,
  format: 'text',
  id: `selection-${content}`,
  source: 'text',
});
const editorData = {
  root: { children: [{ children: [{ text: 'Explain this', type: 'text' }] }], type: 'root' },
};

/**
 * Run settings travel beside the user message on the gateway request (the
 * server derives and validates them itself), so they are the only metadata a
 * client-runtime row may carry that the gateway `userMessage` does not.
 */
const RUN_SETTING_KEYS = new Set<keyof MessageMetadata>(['steer', 'trigger']);

type SendParams = Parameters<ReturnType<typeof useChatStore.getState>['sendMessage']>[0];

const sendThroughClientRuntime = async (params: SendParams) => {
  const { result } = renderHook(() => useChatStore());
  const sendMessageInServer = vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
    assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
    messages: [
      createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
      createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
    ],
    topicId: TEST_IDS.TOPIC_ID,
    userMessageId: TEST_IDS.USER_MESSAGE_ID,
  } as any);
  act(() => {
    useChatStore.setState({ executeClientAgent: vi.fn(), isGatewayModeEnabled: () => false });
  });

  await act(async () => {
    await result.current.sendMessage(params);
  });

  return sendMessageInServer.mock.calls[0][0].newUserMessage;
};

const sendThroughGateway = async (params: SendParams) => {
  const { result } = renderHook(() => useChatStore());
  const executeGatewayAgent = vi.fn().mockResolvedValue({
    assistantMessageId: 'msg_assistant',
    operationId: 'op_gateway',
    topicId: TEST_IDS.TOPIC_ID,
    userMessageId: 'msg_user',
  });
  act(() => {
    useChatStore.setState({ executeGatewayAgent, isGatewayModeEnabled: () => true });
  });

  await act(async () => {
    await result.current.sendMessage(params);
  });

  return executeGatewayAgent.mock.calls[0][0];
};

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendMessage: the gateway persists the user message a client-runtime send persists', () => {
  // ROOT CAUSE:
  //
  // A gateway send never calls `sendMessageInServer`: the server builds the user
  // row from the `execAgent` request, which carried only the fields someone had
  // remembered to wire one by one. Attached quotes, then queued follow-ups'
  // quotes and rich text, were each dropped there, and the persisted row
  // replaced an optimistic one that still showed them.
  //
  // Both transports now take the user message from the same metadata object, so
  // this compares them field by field instead of listing fields.
  it.each<[string, SendParams]>([
    [
      'a composer send with an attached quote and rich text',
      { context, contextSelections: [quote('picked')], editorData, message: 'Explain this' },
    ],
    [
      'a queued follow-up whose quotes ride in its metadata',
      {
        context,
        editorData,
        message: 'Explain this',
        metadata: { contextSelections: [quote('queued')], steer: true },
      },
    ],
    [
      'a follow-up an MCP App view posted',
      {
        context,
        contextSelections: [quote('view')],
        editorData,
        message: 'What should I wear in Paris?',
        metadata: { mcpAppSource: { identifier: 'weather-demo' } },
      },
    ],
  ])('%s', async (_label, params) => {
    const clientRow = await sendThroughClientRuntime(params);
    vi.restoreAllMocks();
    resetTestEnvironment();
    setupMockSelectors();
    spyOnMessageService();
    vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
    vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
    const gatewayRequest = await sendThroughGateway(params);

    const clientMetadata = (clientRow.metadata ?? {}) as MessageMetadata;
    const gatewayMetadata = (gatewayRequest.userMessage?.metadata ?? {}) as MessageMetadata;

    // Every field the client-runtime row carries reaches the gateway row,
    // unless it is a run setting the request carries separately.
    for (const key of Object.keys(clientMetadata) as (keyof MessageMetadata)[]) {
      if (RUN_SETTING_KEYS.has(key)) continue;
      expect(COMPOSER_USER_MESSAGE_METADATA_KEYS, `metadata.${key} has no gateway path`).toContain(
        key,
      );
      expect(gatewayMetadata[key], `metadata.${key}`).toEqual(clientMetadata[key]);
    }
    expect(gatewayRequest.userMessage?.editorData).toEqual(clientRow.editorData);
    expect(gatewayMetadata.contextSelections?.length).toBe(1);
  });

  it('sends no user message payload for a plain-text send', async () => {
    const gatewayRequest = await sendThroughGateway({ context, message: 'Hello' });

    expect(gatewayRequest.userMessage).toBeUndefined();
  });
});
