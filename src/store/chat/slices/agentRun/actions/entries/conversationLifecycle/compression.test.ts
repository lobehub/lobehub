import { toast } from '@lobehub/ui';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import {
  INPUT_LOADING_OPERATION_TYPES,
  isQueueBlockingOperation,
} from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../../../../store';

vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: { getGeneralAccess: vi.fn() },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } },
  },
}));

const agentId = 'agent-1';
const topicId = 'topic-1';
const context = { agentId, threadId: null, topicId };
const key = messageMapKey({ agentId, topicId });
const originalMessages = [
  { content: 'question', id: 'user-1', role: 'user', topicId },
  { content: 'answer', id: 'assistant-1', role: 'assistant', topicId },
] as any[];

const closeToast = vi.fn();

const getMessageIds = () => (useChatStore.getState().dbMessagesMap[key] ?? []).map((m) => m.id);

beforeEach(() => {
  useChatStore.setState(useChatStore.getInitialState());
  vi.spyOn(agentSelectors, 'getAgentConfigById').mockImplementation(
    () => () => ({ model: 'gpt-4o-mini', provider: 'openai' }) as any,
  );

  act(() => {
    useChatStore.setState({
      activeAgentId: agentId,
      activeTopicId: topicId,
      topicDataMap: {},
      dbMessagesMap: { [key]: originalMessages },
      messagesMap: { [key]: originalMessages },
    });
  });

  vi.spyOn(messageService, 'createCompressionGroup').mockResolvedValue({
    messageGroupId: 'group-1',
    messages: [{ content: '', id: 'group-1', role: 'compressedGroup' } as any],
    messagesToSummarize: originalMessages,
  });
  vi.spyOn(messageService, 'cancelCompression').mockResolvedValue({
    messages: originalMessages,
  });
  vi.spyOn(toast, 'error').mockImplementation(() => ({ close: closeToast }) as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  closeToast.mockReset();
});

describe('executeCompression', () => {
  it('keeps a source-only compaction visible and allows the composer Stop action to cancel it', async () => {
    const prior = {
      id: 'prior-summary',
      role: 'compressedGroup',
      content: 'prior',
      threadId: null,
      topicId,
    };
    useChatStore.setState({
      dbMessagesMap: { [key]: [prior] as any },
      messagesMap: { [key]: [prior] as any },
    });
    vi.mocked(messageService.createCompressionGroup).mockResolvedValue({
      messageGroupId: 'group-1',
      messages: [prior] as any,
      messagesToSummarize: [],
      existingSummary: 'prior',
    });
    vi.mocked(messageService.cancelCompression).mockResolvedValue({ messages: [prior] as any });
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(
      async ({ abortController }) => {
        expect(getMessageIds()).toContain('group-1');
        expect(
          operationSelectors.isInputVisiblyLoadingByContext(context)(useChatStore.getState()),
        ).toBe(true);
        const operation = Object.values(useChatStore.getState().operations).find(
          (op) => op.type === 'contextCompression' && op.status === 'running',
        )!;
        expect(isQueueBlockingOperation(operation)).toBe(true);
        await useChatStore
          .getState()
          .cancelOperations({ ...context, status: 'running', type: INPUT_LOADING_OPERATION_TYPES });
        expect(abortController?.signal.aborted).toBe(true);
      },
    );
    expect(await useChatStore.getState().executeCompression(context, '')).toBe(false);
    expect(getMessageIds()).toEqual(['prior-summary']);
    expect(messageService.cancelCompression).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('sends the queued follow-up after manual compression succeeds', async () => {
    const originalSend = useChatStore.getState().sendMessage;
    const send = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: send });
    vi.spyOn(messageService, 'finalizeCompression').mockResolvedValue({ messages: [] });
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(
      async ({ onMessageHandle }) => {
        useChatStore.getState().enqueueMessage(key, {
          id: 'queued',
          content: 'next question',
          createdAt: Date.now(),
          interruptMode: 'soft',
        });
        onMessageHandle?.({ type: 'text', text: 'summary' });
      },
    );
    try {
      expect(await useChatStore.getState().executeCompression(context, '')).toBe(true);
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ message: 'next question' })),
      );
    } finally {
      useChatStore.setState({ sendMessage: originalSend, queuedMessages: {} });
    }
  });

  it('keeps a hidden regenerated sibling out of manual compression', async () => {
    const hidden = { id: 'hidden-sibling', role: 'assistant', content: 'HIDDEN', topicId };
    useChatStore.setState({
      dbMessagesMap: { [key]: [...originalMessages, hidden] as any },
      messagesMap: { [key]: originalMessages },
    });
    vi.spyOn(messageService, 'finalizeCompression').mockResolvedValue({ messages: [] });
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(
      async ({ onMessageHandle }) => {
        onMessageHandle?.({ type: 'text', text: 'summary' });
      },
    );
    expect(await useChatStore.getState().executeCompression(context, '')).toBe(true);
    expect(messageService.createCompressionGroup).toHaveBeenCalledWith(
      expect.objectContaining({ messageIds: ['user-1', 'assistant-1'] }),
    );
  });
  it('restores the server group and original history when the summary is cancelled', async () => {
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'AbortError' }),
    );
    const succeeded = await useChatStore.getState().executeCompression(context, '');
    expect(succeeded).toBe(false);
    expect(messageService.cancelCompression).toHaveBeenCalledTimes(1);
    expect(getMessageIds()).toEqual(['user-1', 'assistant-1']);
    expect(toast.error).not.toHaveBeenCalled();
    expect(
      Object.values(useChatStore.getState().operations)
        .filter((op) => op.type === 'contextCompression')
        .every((op) => op.status !== 'running'),
    ).toBe(true);
  });

  it('includes the previous summary and supersedes it when compacting again', async () => {
    const prior = {
      id: 'prior-summary',
      role: 'compressedGroup',
      content: 'stale local draft',
      threadId: null,
      topicId,
    };
    vi.mocked(messageService.createCompressionGroup).mockResolvedValue({
      messageGroupId: 'group-1',
      messages: [],
      messagesToSummarize: originalMessages,
      existingSummary: 'EARLIER DECISION',
    });
    useChatStore.setState({
      dbMessagesMap: { [key]: [prior, ...originalMessages] as any },
      messagesMap: { [key]: [prior, ...originalMessages] as any },
    });
    vi.spyOn(messageService, 'finalizeCompression').mockResolvedValue({
      messages: [{ id: 'group-1', role: 'compressedGroup', content: 'combined' } as any],
    });
    const fetch = vi
      .spyOn(chatService, 'fetchPresetTaskResult')
      .mockImplementation(async ({ onMessageHandle }) => {
        onMessageHandle?.({ type: 'text', text: 'combined' });
      });
    expect(await useChatStore.getState().executeCompression(context, '')).toBe(true);
    expect(JSON.stringify(fetch.mock.calls[0][0].params?.messages)).toContain('EARLIER DECISION');
    expect(messageService.finalizeCompression).toHaveBeenCalledWith(
      expect.objectContaining({ sourceGroupIds: ['prior-summary'] }),
    );
    expect(getMessageIds()).toEqual(['group-1']);
  });
  it('keeps the original messages when the summary request fails', async () => {
    const finalizeSpy = vi.spyOn(messageService, 'finalizeCompression');
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(async ({ onError }) => {
      onError?.(new Error('Request blocked by chat security'), undefined);
    });

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await useChatStore.getState().executeCompression(context, '');
    });

    expect(succeeded).toBe(false);
    expect(finalizeSpy).not.toHaveBeenCalled();
    expect(messageService.cancelCompression).toHaveBeenCalledWith({
      agentId,
      groupId: undefined,
      messageGroupId: 'group-1',
      threadId: null,
      topicId,
    });
    expect(getMessageIds()).toEqual(['user-1', 'assistant-1']);
    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('Request blocked by chat security'),
        duration: 0,
      }),
    );
  });

  it('reruns the compaction from the failure toast', async () => {
    const fetchSpy = vi
      .spyOn(chatService, 'fetchPresetTaskResult')
      .mockImplementation(async ({ onError }) => {
        onError?.(new Error('timeout'), undefined);
      });

    await act(async () => {
      await useChatStore.getState().executeCompression(context, '');
    });

    const [{ actions }] = vi.mocked(toast.error).mock.calls[0] as [any];
    await act(async () => {
      actions[0].onClick();
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(messageService.createCompressionGroup).toHaveBeenCalledTimes(2);
    expect(closeToast).toHaveBeenCalledTimes(1);
  });

  it('runs the caller retry flow from the failure toast when provided', async () => {
    const onRetry = vi.fn();
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(async ({ onError }) => {
      onError?.(new Error('timeout'), undefined);
    });

    await act(async () => {
      await useChatStore.getState().executeCompression(context, '', { onRetry });
    });

    const [{ actions }] = vi.mocked(toast.error).mock.calls[0] as [any];
    actions[0].onClick();

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(closeToast).toHaveBeenCalledTimes(1);
    expect(messageService.createCompressionGroup).toHaveBeenCalledTimes(1);
  });

  it('does not finalize an empty summary', async () => {
    const finalizeSpy = vi.spyOn(messageService, 'finalizeCompression');
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(
      async ({ onMessageHandle }) => {
        onMessageHandle?.({ text: '  ', type: 'text' });
      },
    );

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await useChatStore.getState().executeCompression(context, '');
    });

    expect(succeeded).toBe(false);
    expect(finalizeSpy).not.toHaveBeenCalled();
    expect(messageService.cancelCompression).toHaveBeenCalledTimes(1);
    expect(getMessageIds()).toEqual(['user-1', 'assistant-1']);
  });

  it('finalizes the group with the generated summary', async () => {
    const finalized = [{ content: 'summary', id: 'group-1', role: 'compressedGroup' } as any];
    const finalizeSpy = vi
      .spyOn(messageService, 'finalizeCompression')
      .mockResolvedValue({ messages: finalized });
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(
      async ({ onMessageHandle }) => {
        onMessageHandle?.({ text: 'summary', type: 'text' });
      },
    );

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await useChatStore.getState().executeCompression(context, '');
    });

    expect(succeeded).toBe(true);
    expect(finalizeSpy).toHaveBeenCalledWith({
      agentId,
      content: 'summary',
      groupId: undefined,
      messageGroupId: 'group-1',
      sourceGroupIds: [],
      threadId: null,
      topicId,
    });
    expect(messageService.cancelCompression).not.toHaveBeenCalled();
    expect(getMessageIds()).toEqual(['group-1']);
  });

  it('compacts the open thread, not the main conversation it branched from', async () => {
    const threadId = 'thread-1';
    const threadContext = { agentId, threadId, topicId };
    const threadKey = messageMapKey(threadContext);
    // A thread page shows the main-conversation turn it branched from (read back with
    // `threadId: null`), then its own turns.
    const threadMessages = [
      ...originalMessages.map((message) => ({ ...message, threadId: null })),
      { content: 'follow-up', id: 'thread-user-1', role: 'user', threadId, topicId },
      { content: 'reply', id: 'thread-assistant-1', role: 'assistant', threadId, topicId },
    ] as any[];
    act(() => {
      useChatStore.setState({
        dbMessagesMap: { [threadKey]: threadMessages },
        messagesMap: { [threadKey]: threadMessages },
      });
    });
    const finalizeSpy = vi
      .spyOn(messageService, 'finalizeCompression')
      .mockResolvedValue({ messages: [] });
    vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation(
      async ({ onMessageHandle }) => {
        onMessageHandle?.({ text: 'summary', type: 'text' });
      },
    );

    await act(async () => {
      await useChatStore.getState().executeCompression(threadContext, '');
    });

    expect(messageService.createCompressionGroup).toHaveBeenCalledWith({
      agentId,
      groupId: undefined,
      messageIds: ['thread-user-1', 'thread-assistant-1'],
      sourceGroupIds: [],
      threadId,
      topicId,
    });
    expect(finalizeSpy).toHaveBeenCalledWith(expect.objectContaining({ threadId, topicId }));
  });

  describe('summary model', () => {
    const runWithSummary = async (options?: Parameters<ChatStore['executeCompression']>[2]) => {
      vi.spyOn(messageService, 'finalizeCompression').mockResolvedValue({ messages: [] });
      const fetchSpy = vi
        .spyOn(chatService, 'fetchPresetTaskResult')
        .mockImplementation(async ({ onMessageHandle }) => {
          onMessageHandle?.({ text: 'summary', type: 'text' });
        });
      await act(async () => {
        await useChatStore.getState().executeCompression(context, '', options);
      });
      return fetchSpy.mock.calls[0][0].params;
    };

    const pinTopicModel = () =>
      act(() => {
        useChatStore.setState({
          topicDataMap: {
            [agentId]: {
              items: [{ id: topicId, model: 'claude-opus-4-8', provider: 'anthropic' }],
            } as any,
          },
        });
      });

    it('uses the model pinned to the topic over the agent default', async () => {
      pinTopicModel();

      const params = await runWithSummary();

      expect(params).toMatchObject({ model: 'claude-opus-4-8', provider: 'anthropic' });
    });

    it('uses the pinned model for the exceeded-context compact-and-retry', async () => {
      pinTopicModel();

      // Same options the ExceededContextWindowError card passes.
      const params = await runWithSummary({ beforeMessageId: 'assistant-1', onRetry: vi.fn() });

      expect(params).toMatchObject({ model: 'claude-opus-4-8', provider: 'anthropic' });
    });

    it('falls back to the agent default when the topic has no pinned model', async () => {
      act(() => {
        useChatStore.setState({
          topicDataMap: { [agentId]: { items: [{ id: topicId }] } as any },
        });
      });

      const params = await runWithSummary();

      expect(params).toMatchObject({ model: 'gpt-4o-mini', provider: 'openai' });
    });

    it('ignores a heterogeneous runtime pin, which the chat endpoint cannot serve', async () => {
      vi.spyOn(agentByIdSelectors, 'isAgentHeterogeneousById').mockImplementation(() => () => true);
      // snapshotAgentModel pins the CLI runtime type as the topic provider.
      act(() => {
        useChatStore.setState({
          topicDataMap: {
            [agentId]: { items: [{ id: topicId, model: 'default', provider: 'cursor' }] } as any,
          },
        });
      });

      const params = await runWithSummary();

      expect(params).toMatchObject({ model: 'gpt-4o-mini', provider: 'openai' });
    });

    it('falls back to the agent default when the topic pin has no provider', async () => {
      act(() => {
        useChatStore.setState({
          topicDataMap: { [agentId]: { items: [{ id: topicId, model: 'gpt-5' }] } as any },
        });
      });

      const params = await runWithSummary();

      expect(params).toMatchObject({ model: 'gpt-4o-mini', provider: 'openai' });
    });
  });
});
