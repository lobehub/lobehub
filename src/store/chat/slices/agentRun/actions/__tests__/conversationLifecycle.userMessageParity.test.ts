import type { ContextSelection, MessageMetadata } from '@lobechat/types';
import { COMPOSER_USER_MESSAGE_METADATA_KEYS } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { getSessionStoreState } from '@/store/session';

import { useChatStore } from '../../../../store';
import { createMockAgentConfig, TEST_IDS } from './fixtures';
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
 * server derives and validates them itself), so they are the only metadata of
 * a send the `userMessage` payload does not have to carry.
 */
const RUN_SETTING_KEYS = new Set<keyof MessageMetadata>(['steer', 'trigger']);

type SendParams = Parameters<ReturnType<typeof useChatStore.getState>['sendMessage']>[0];

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

describe('sendMessage: the gateway request carries the whole composer user message', () => {
  // ROOT CAUSE:
  //
  // The server builds the user row from the `execAgent` request, which carried
  // only the fields someone had remembered to wire one by one. Attached quotes,
  // then queued follow-ups' quotes and rich text, were each dropped there, and
  // the persisted row replaced an optimistic one that still showed them.
  //
  // The request now takes the user message from the same metadata object the
  // composer produces, so every key it carries must have a gateway path and
  // reach the payload unchanged. (The browser client runtime that used to
  // persist the row itself is gone, so there is no second transport to compare
  // against.)
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
  ])('%s', async (_label, params) => {
    const gatewayRequest = await sendThroughGateway(params);

    const gatewayMetadata = (gatewayRequest.userMessage?.metadata ?? {}) as MessageMetadata;
    const metadataGiven = (params.metadata ?? {}) as MessageMetadata;

    // Every metadata key the send carries has a gateway path, unless it is a
    // run setting the request carries separately.
    for (const key of new Set<keyof MessageMetadata>([
      ...(Object.keys(gatewayMetadata) as (keyof MessageMetadata)[]),
      ...(Object.keys(metadataGiven) as (keyof MessageMetadata)[]),
    ])) {
      if (RUN_SETTING_KEYS.has(key)) continue;
      expect(COMPOSER_USER_MESSAGE_METADATA_KEYS, `metadata.${key} has no gateway path`).toContain(
        key,
      );
    }
    // What the user attached reaches the row the server persists.
    expect(gatewayRequest.userMessage?.editorData).toEqual(editorData);
    expect(gatewayMetadata.contextSelections).toEqual(
      params.contextSelections ?? metadataGiven.contextSelections,
    );
  });

  it('sends no user message payload for a plain-text send', async () => {
    const gatewayRequest = await sendThroughGateway({ context, message: 'Hello' });

    expect(gatewayRequest.userMessage).toBeUndefined();
  });
});
