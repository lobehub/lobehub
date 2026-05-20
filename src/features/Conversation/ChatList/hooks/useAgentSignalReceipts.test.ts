import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSignalService } from '@/services/agentSignal';

import { useAgentSignalReceipts } from './useAgentSignalReceipts';

const { receipt } = vi.hoisted(() => ({
  receipt: {
    agentId: 'agent-1',
    anchorMessageId: 'assistant-1',
    createdAt: 1_700_000,
    detail: 'Saved this for future replies',
    id: 'receipt-1',
    kind: 'memory' as const,
    sourceId: 'source-1',
    sourceType: 'client.gateway.runtime_end',
    status: 'applied' as const,
    title: 'Memory saved',
    topicId: 'topic-1',
    userId: 'user-1',
  },
}));

vi.mock('@/services/agentSignal', () => ({
  agentSignalService: {
    listReceipts: vi.fn().mockResolvedValue({
      cursor: undefined,
      receipts: [receipt],
    }),
  },
}));

const message = (input: Partial<UIChatMessage> & { id: string; role: UIChatMessage['role'] }) =>
  ({
    content: '',
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }) as UIChatMessage;

describe('useAgentSignalReceipts', () => {
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const renderReceiptsHook = (input: Parameters<typeof useAgentSignalReceipts>[0]) =>
    renderHook(() => useAgentSignalReceipts(input), { wrapper });

  it('groups anchored receipts by anchorMessageId', async () => {
    const { result } = renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [
        message({ id: 'user-1', role: 'user' }),
        message({ id: 'assistant-1', parentId: 'user-1', role: 'assistant' }),
      ],
      enabled: true,
      topicId: 'topic-1',
    });

    await waitFor(() => {
      expect(result.current.receiptsByAnchor.get('assistant-1')).toEqual([
        expect.objectContaining({ id: 'receipt-1' }),
      ]);
    });
    expect(agentSignalService.listReceipts).toHaveBeenCalledWith({
      agentId: 'agent-1',
      limit: 20,
      topicId: 'topic-1',
    });
  });

  it('groups anchored receipts under the assistant group when the anchor is a child block', async () => {
    vi.mocked(agentSignalService.listReceipts).mockResolvedValueOnce({
      cursor: undefined,
      receipts: [{ ...receipt, anchorMessageId: 'assistant-child-2', id: 'receipt-child-anchor' }],
    });

    const { result } = renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [
        message({ id: 'user-1', role: 'user' }),
        message({
          children: [
            { content: 'First assistant step', id: 'assistant-child-1' },
            { content: 'Final assistant step', id: 'assistant-child-2' },
          ],
          id: 'assistant-group-1',
          parentId: 'user-1',
          role: 'assistantGroup',
        }),
      ],
      enabled: true,
      topicId: 'topic-1',
    });

    await waitFor(() => {
      expect(result.current.receiptsByAnchor.get('assistant-group-1')).toEqual([
        expect.objectContaining({ id: 'receipt-child-anchor' }),
      ]);
    });
    expect(result.current.receiptsByAnchor.get('assistant-child-2')).toBeUndefined();
  });

  it('groups trigger-only receipts under the assistant child message when present', async () => {
    vi.mocked(agentSignalService.listReceipts).mockResolvedValueOnce({
      cursor: undefined,
      receipts: [
        {
          ...receipt,
          anchorMessageId: undefined,
          id: 'receipt-trigger',
          triggerMessageId: 'user-1',
        },
      ],
    });

    const { result } = renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [
        message({ id: 'user-1', role: 'user' }),
        message({ id: 'assistant-1', parentId: 'user-1', role: 'assistant' }),
      ],
      enabled: true,
      topicId: 'topic-1',
    });

    await waitFor(() => {
      expect(result.current.receiptsByAnchor.get('assistant-1')).toEqual([
        expect.objectContaining({ id: 'receipt-trigger' }),
      ]);
    });
    expect(result.current.receiptsByAnchor.get('user-1')).toBeUndefined();
  });

  it('groups trigger-only receipts under the assistant group child message when present', async () => {
    vi.mocked(agentSignalService.listReceipts).mockResolvedValueOnce({
      cursor: undefined,
      receipts: [
        {
          ...receipt,
          anchorMessageId: undefined,
          id: 'receipt-trigger',
          triggerMessageId: 'user-1',
        },
      ],
    });

    const { result } = renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [
        message({ id: 'user-1', role: 'user' }),
        message({ id: 'assistant-group-1', parentId: 'user-1', role: 'assistantGroup' }),
      ],
      enabled: true,
      topicId: 'topic-1',
    });

    await waitFor(() => {
      expect(result.current.receiptsByAnchor.get('assistant-group-1')).toEqual([
        expect.objectContaining({ id: 'receipt-trigger' }),
      ]);
    });
    expect(result.current.receiptsByAnchor.get('user-1')).toBeUndefined();
  });

  it('groups trigger-only receipts under the trigger message when no assistant child exists', async () => {
    vi.mocked(agentSignalService.listReceipts).mockResolvedValueOnce({
      cursor: undefined,
      receipts: [
        {
          ...receipt,
          anchorMessageId: undefined,
          id: 'receipt-trigger',
          triggerMessageId: 'user-1',
        },
      ],
    });

    const { result } = renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [message({ id: 'user-1', role: 'user' })],
      enabled: true,
      topicId: 'topic-1',
    });

    await waitFor(() => {
      expect(result.current.receiptsByAnchor.get('user-1')).toEqual([
        expect.objectContaining({ id: 'receipt-trigger' }),
      ]);
    });
  });

  it('does not group receipts without anchorMessageId or triggerMessageId', async () => {
    vi.mocked(agentSignalService.listReceipts).mockResolvedValueOnce({
      cursor: undefined,
      receipts: [{ ...receipt, anchorMessageId: undefined, id: 'receipt-floating' }],
    });

    const { result } = renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [message({ id: 'assistant-1', role: 'assistant' })],
      enabled: true,
      topicId: 'topic-1',
    });

    await waitFor(() => {
      expect(agentSignalService.listReceipts).toHaveBeenCalled();
    });
    expect([...result.current.receiptsByAnchor.values()].flat()).toEqual([]);
    expect('unanchoredReceipts' in result.current).toBe(false);
  });

  it('does not fetch receipts when the feature flag is disabled', async () => {
    renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [],
      enabled: false,
      topicId: 'topic-1',
    });

    expect(agentSignalService.listReceipts).not.toHaveBeenCalled();
  });

  it('keeps refreshing receipts while the current topic is mounted', async () => {
    vi.useFakeTimers();
    vi.mocked(agentSignalService.listReceipts)
      .mockResolvedValueOnce({
        cursor: undefined,
        receipts: [receipt],
      })
      .mockResolvedValueOnce({
        cursor: undefined,
        receipts: [],
      });

    renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [],
      enabled: true,
      topicId: 'topic-1',
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(agentSignalService.listReceipts).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(agentSignalService.listReceipts).toHaveBeenCalledTimes(2);
    expect(agentSignalService.listReceipts).toHaveBeenLastCalledWith({
      agentId: 'agent-1',
      limit: 20,
      sinceCreatedAt: 1_700_000,
      topicId: 'topic-1',
    });
  });

  it('backs off receipt refreshes when no new receipts are available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    vi.mocked(agentSignalService.listReceipts).mockResolvedValue({
      cursor: undefined,
      receipts: [],
    });

    renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [],
      enabled: true,
      topicId: 'topic-1',
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(agentSignalService.listReceipts).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(agentSignalService.listReceipts).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(agentSignalService.listReceipts).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(agentSignalService.listReceipts).toHaveBeenCalledTimes(3);
  });

  it('stops refreshing receipts after five minutes in the current topic scope', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    vi.mocked(agentSignalService.listReceipts).mockResolvedValue({
      cursor: undefined,
      receipts: [],
    });

    renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [],
      enabled: true,
      topicId: 'topic-1',
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    const callsAtTimeout = vi.mocked(agentSignalService.listReceipts).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(agentSignalService.listReceipts).toHaveBeenCalledTimes(callsAtTimeout);
  });

  it('restarts the polling window when new work starts in the same topic scope', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    vi.mocked(agentSignalService.listReceipts).mockResolvedValue({
      cursor: undefined,
      receipts: [],
    });

    const { rerender } = renderHook(
      ({ pollingSignal }) =>
        useAgentSignalReceipts({
          agentId: 'agent-1',
          displayMessages: [],
          enabled: true,
          pollingSignal,
          topicId: 'topic-1',
        }),
      { initialProps: { pollingSignal: 'assistant-1' }, wrapper },
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    const callsAtTimeout = vi.mocked(agentSignalService.listReceipts).mock.calls.length;

    vi.setSystemTime(new Date(5 * 60_000));
    rerender({ pollingSignal: 'assistant-2' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(agentSignalService.listReceipts).toHaveBeenCalledTimes(callsAtTimeout + 1);
  });
});
