import type { ConversationContext } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createMockMessage, createMockResolvedAgentConfig } from '../__tests__/fixtures';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      resolveAgentInterventionBySource: { mutate: vi.fn() },
    },
  },
}));

vi.mock('@/utils/localStorage', () => ({
  AsyncLocalStorage: class {
    getFromLocalStorageSync() {
      return {};
    }
    async getFromLocalStorage() {
      return {};
    }
    async saveToLocalStorage() {}
  },
}));

const context: ConversationContext = {
  agentId: 'member-agent',
  groupId: 'group',
  scope: 'thread',
  threadId: 'member-thread',
  topicId: 'topic',
};
const toolMessageId = 'pending-tool';
const sourceMutation = () =>
  vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate);

const seed = (serverSource = true) => {
  const message = createMockMessage({
    id: toolMessageId,
    plugin: { apiName: 'askUser', arguments: '{}', identifier: 'lobe-agent', type: 'builtin' },
    pluginIntervention: {
      batchId: serverSource ? 'server-batch' : 'client-op:1:assistant',
      operationId: serverSource ? 'original-server-op' : 'client-op',
      runtimeType: serverSource ? 'server' : 'client',
      status: 'pending',
    },
    role: 'tool',
    tool_call_id: 'call-question',
  });
  const key = messageMapKey(context);
  useChatStore.setState({
    activeAgentId: 'different-active-agent',
    dbMessagesMap: { [key]: [message] },
    gatewayConnections: {},
    messagesMap: { [key]: [message] },
    operations: {},
    questionSubmissions: {},
  });
  const store = useChatStore.getState();
  vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(() =>
    createMockResolvedAgentConfig(),
  );
  vi.spyOn(agentByIdSelectors, 'getAgentById').mockReturnValue(() => undefined);
  vi.spyOn(store, 'isGatewayModeEnabled').mockReturnValue(false);
  vi.spyOn(store, 'executeGatewayAgent').mockResolvedValue({} as never);
  vi.spyOn(store, 'executeClientAgent').mockResolvedValue(undefined);
  vi.spyOn(store, 'optimisticCreateMessage').mockResolvedValue({
    id: 'synthetic-user',
    messages: [],
  });
  vi.spyOn(store, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
  vi.spyOn(store, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
  vi.spyOn(store, 'internal_createAgentState').mockReturnValue({
    agentConfig: createMockResolvedAgentConfig(),
    context: { phase: 'init' },
    state: {},
  } as never);
  vi.spyOn(store, 'updateTopicStatus').mockResolvedValue(undefined);
  vi.spyOn(store, 'refreshMessages').mockResolvedValue(undefined);
  return store;
};

beforeEach(() => {
  sourceMutation()
    .mockReset()
    .mockResolvedValue({
      contractVersion: 2,
      state: 'claimed',
      status: 'resolved',
      success: true,
    } as never);
});
afterEach(() => vi.restoreAllMocks());

const actions = {
  approve: () => useChatStore.getState().approveToolCalling(toolMessageId, '', context),
  approveAll: () => useChatStore.getState().approveAllToolCalls([toolMessageId], context),
  answer: () =>
    useChatStore.getState().submitToolInteraction(toolMessageId, { Color: 'Blue' }, context),
  reject: () => useChatStore.getState().rejectToolCalling(toolMessageId, 'Denied', context),
  rejectContinue: () =>
    useChatStore.getState().rejectAndContinueToolCalling(toolMessageId, 'Denied', context),
  skip: () => useChatStore.getState().skipToolInteraction(toolMessageId, undefined, context),
  cancel: () => useChatStore.getState().cancelToolInteraction(toolMessageId, context),
};

describe('server-origin intervention with client-configured agent after reload', () => {
  it.each(Object.entries(actions))(
    'routes %s through the original source without local execution',
    async (_name, action) => {
      const store = seed();
      await action();
      expect(sourceMutation()).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: 'server-batch',
          operationId: 'original-server-op',
          targets: [{ toolCallId: 'call-question', toolMessageId }],
        }),
      );
      expect(store.executeClientAgent).not.toHaveBeenCalled();
      expect(store.optimisticCreateMessage).not.toHaveBeenCalled();
      expect(store.optimisticUpdateMessagePlugin).not.toHaveBeenCalled();
      expect(store.optimisticUpdateMessageContent).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(actions) as (keyof typeof actions)[])(
    'falls back to the configured client path for %s when the source is unavailable',
    async (action) => {
      const store = seed();
      sourceMutation().mockResolvedValue({
        contractVersion: 2,
        status: 'unavailable',
        success: false,
      } as never);
      await actions[action]();
      expect(sourceMutation()).toHaveBeenCalled();
      if (action === 'reject' || action === 'cancel') {
        expect(store.executeClientAgent).not.toHaveBeenCalled();
      } else {
        expect(store.executeClientAgent).toHaveBeenCalledOnce();
      }
      expect(store.executeGatewayAgent).not.toHaveBeenCalled();
      expect(store.optimisticUpdateMessagePlugin).toHaveBeenCalled();
      expect(operationSelectors.isMessageProcessing(toolMessageId)(useChatStore.getState())).toBe(
        false,
      );
    },
  );

  it('clears processing when the client rejection continuation fails', async () => {
    const store = seed();
    sourceMutation().mockResolvedValue({ success: false } as never);
    vi.mocked(store.executeClientAgent).mockRejectedValueOnce(new Error('client failed'));
    await actions.rejectContinue();
    expect(operationSelectors.isMessageProcessing(toolMessageId)(useChatStore.getState())).toBe(
      false,
    );
    expect(Object.values(useChatStore.getState().operations)).toContainEqual(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it.each(['approve', 'answer'] as const)(
    'keeps the configured Gateway legacy path for %s when the source is unavailable',
    async (action) => {
      const store = seed();
      vi.mocked(store.isGatewayModeEnabled).mockReturnValue(true);
      sourceMutation().mockResolvedValue({
        contractVersion: 2,
        status: 'unavailable',
        success: false,
      } as never);
      await actions[action]();
      expect(store.executeGatewayAgent).toHaveBeenCalledOnce();
      expect(store.executeClientAgent).not.toHaveBeenCalled();
      expect(store.optimisticUpdateMessagePlugin).not.toHaveBeenCalled();
    },
  );

  it('applies staged approval edits before the client fallback executes', async () => {
    const store = seed();
    sourceMutation().mockResolvedValue({ success: false } as never);
    const prepare = vi.fn(async () => {
      const key = messageMapKey(context);
      const messages = useChatStore.getState().dbMessagesMap[key].map((message) => ({
        ...message,
        plugin: { ...message.plugin!, arguments: '{"path":"edited"}' },
      }));
      useChatStore.setState({ dbMessagesMap: { [key]: messages } });
    });
    await store.approveToolCalling(toolMessageId, '', context, {
      editedArguments: { path: 'edited' },
      onLegacyEditFallback: prepare,
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(store.executeClientAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContext: expect.objectContaining({
          payload: expect.objectContaining({
            approvedToolCall: expect.objectContaining({ arguments: '{"path":"edited"}' }),
          }),
        }),
      }),
    );
  });

  it.each(['skip', 'cancel'] as const)(
    'preserves the %s legacy side effect on client fallback',
    async (action) => {
      const store = seed();
      sourceMutation().mockResolvedValue({ success: false } as never);
      const prepare = vi.fn(async () => {});
      if (action === 'skip')
        await store.skipToolInteraction(toolMessageId, undefined, context, {
          onLegacyFallback: prepare,
        });
      else await store.cancelToolInteraction(toolMessageId, context, { onLegacyFallback: prepare });
      expect(prepare).toHaveBeenCalledOnce();
      expect(store.executeGatewayAgent).not.toHaveBeenCalled();
    },
  );

  it('subscribes to the server-created continuation in the original group thread', async () => {
    const store = seed();
    const execution = { operationId: 'server-continuation' };
    sourceMutation().mockResolvedValueOnce({
      contractVersion: 2,
      execution,
      state: 'claimed',
      status: 'resolved',
      success: true,
    } as never);
    await actions.answer();
    expect(store.executeGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        precreatedResult: execution,
      }),
    );
    expect(store.executeClientAgent).not.toHaveBeenCalled();
  });

  it('keeps the pending card and surfaces a failed server answer for retry', async () => {
    const store = seed();
    const error = new Error('source unavailable');
    sourceMutation().mockRejectedValueOnce(error);
    await expect(actions.answer()).rejects.toThrow(error);
    expect(store.executeClientAgent).not.toHaveBeenCalled();
    expect(store.optimisticUpdateMessagePlugin).not.toHaveBeenCalled();
    expect(store.optimisticUpdateMessageContent).not.toHaveBeenCalled();
    expect(Object.values(useChatStore.getState().operations)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ]);
    await actions.answer();
    expect(sourceMutation()).toHaveBeenCalledTimes(2);
    expect(sourceMutation().mock.calls[1][0]).toEqual(sourceMutation().mock.calls[0][0]);
  });

  it('leaves a source already answered elsewhere to the server and refreshes', async () => {
    const store = seed();
    sourceMutation().mockResolvedValueOnce({
      contractVersion: 2,
      state: 'already_resolved',
      status: 'resolved',
      success: true,
    } as never);
    await actions.answer();
    expect(store.refreshMessages).toHaveBeenCalledWith(context);
    expect(store.executeClientAgent).not.toHaveBeenCalled();
    expect(store.executeGatewayAgent).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps a client question on its originating runtime even when gateway mode is %s',
    async (gatewayEnabled) => {
      const store = seed(false);
      vi.mocked(store.isGatewayModeEnabled).mockReturnValue(gatewayEnabled);
      await useChatStore
        .getState()
        .submitToolInteraction(toolMessageId, { Color: 'Blue' }, context, {
          createUserMessage: false,
        });
      expect(sourceMutation()).not.toHaveBeenCalled();
      expect(store.executeClientAgent).toHaveBeenCalledOnce();
      expect(store.optimisticUpdateMessagePlugin).toHaveBeenCalled();
    },
  );
});
