import { type UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/**
 * Row-local mutations ask the server for a delta (`{ success }`) instead of the
 * whole topic: the store keeps its optimistically patched row. The legacy
 * fallback — refetch when no list came back — must not fire on a delta, or the
 * saved re-read is just moved to the client.
 */
const context = { agentId: 'agt_1', topicId: 'tpc_1' };
const key = messageMapKey(context);
const row = (overrides: Partial<UIChatMessage> = {}) =>
  ({
    content: 'old',
    createdAt: 1,
    id: 'msg_1',
    metadata: { keep: true },
    role: 'assistant',
    updatedAt: 1,
    ...overrides,
  }) as UIChatMessage;

const localRow = () => useChatStore.getState().dbMessagesMap[key]?.find((m) => m.id === 'msg_1');

let refreshMessages: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMessages = vi.fn();
  act(() => {
    useChatStore.setState({
      activeAgentId: context.agentId,
      activeTopicId: context.topicId,
      dbMessagesMap: { [key]: [row()] },
      refreshMessages,
    } as any);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('optimisticUpdateMessageContent delta return', () => {
  it('requests a delta, keeps every written column locally and does not refetch', async () => {
    const update = vi.spyOn(messageService, 'updateMessage').mockResolvedValue({ success: true });

    await act(async () => {
      await useChatStore.getState().optimisticUpdateMessageContent('msg_1', 'new', {
        metadata: { finishType: 'stop' } as any,
        reasoning: { content: 'thought' },
        tools: [{ apiName: 'a', arguments: '{}', id: 'call_1', identifier: 'x', type: 'default' }],
      });
    });

    expect(update.mock.calls[0][2]).toMatchObject({ ...context, returnMode: 'delta' });
    // Before, a tools update dispatched only `tools` and relied on the full
    // list for content/reasoning; with a delta the local row must carry them.
    expect(localRow()).toMatchObject({
      content: 'new',
      metadata: { finishType: 'stop', keep: true },
      reasoning: { content: 'thought' },
      tools: [expect.objectContaining({ id: 'call_1' })],
    });
    expect(refreshMessages).not.toHaveBeenCalled();
  });

  it('keeps the full list for new images, whose file URLs only the server resolves', async () => {
    const serverRows = [row({ content: 'new', imageList: [{ alt: '', id: 'f', url: 'u' }] })];
    const update = vi
      .spyOn(messageService, 'updateMessage')
      .mockResolvedValue({ messages: serverRows, success: true });

    await act(async () => {
      await useChatStore.getState().optimisticUpdateMessageContent('msg_1', 'new', {
        imageList: [{ alt: '', id: 'f', url: 'blob:' }],
      });
    });

    expect(update.mock.calls[0][2]).not.toHaveProperty('returnMode');
    expect(localRow()?.imageList).toEqual([{ alt: '', id: 'f', url: 'u' }]);
  });

  it('still refetches when the write failed', async () => {
    vi.spyOn(messageService, 'updateMessage').mockResolvedValue({ success: false });

    await act(async () => {
      await useChatStore.getState().optimisticUpdateMessageContent('msg_1', 'new');
    });

    expect(refreshMessages).toHaveBeenCalledTimes(1);
  });
});

describe('optimisticUpdateMessageMetadata delta return', () => {
  it('requests a delta and does not refetch for a row-local metadata patch', async () => {
    const update = vi
      .spyOn(messageService, 'updateMessageMetadata')
      .mockResolvedValue({ success: true });

    await act(async () => {
      await useChatStore.getState().optimisticUpdateMessageMetadata('msg_1', { collapsed: true });
    });

    expect(update.mock.calls[0][2]).toMatchObject({ returnMode: 'delta' });
    expect(localRow()?.metadata).toMatchObject({ collapsed: true, keep: true });
    expect(refreshMessages).not.toHaveBeenCalled();
  });

  it('keeps the full list for a branch switch', async () => {
    const update = vi
      .spyOn(messageService, 'updateMessageMetadata')
      .mockResolvedValue({ messages: [row()], success: true });

    await act(async () => {
      await useChatStore.getState().optimisticUpdateMessageMetadata('msg_1', {
        activeBranchIndex: 1,
      });
    });

    expect(update.mock.calls[0][2]).not.toHaveProperty('returnMode');
  });
});
