import { toast } from '@lobehub/ui';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { agentSelectors } from '@/store/agent/selectors';
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
  vi.spyOn(agentSelectors, 'getAgentConfigById').mockImplementation(
    () => () => ({ model: 'gpt-4o-mini', provider: 'openai' }) as any,
  );

  act(() => {
    useChatStore.setState({
      activeAgentId: agentId,
      activeTopicId: topicId,
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
      messageGroupId: 'group-1',
      topicId,
    });
    expect(messageService.cancelCompression).not.toHaveBeenCalled();
    expect(getMessageIds()).toEqual(['group-1']);
  });
});
