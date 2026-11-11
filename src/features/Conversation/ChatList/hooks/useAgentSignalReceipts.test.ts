import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { agentSignalService } from '@/services/agentSignal';
import { useAgentSignalStore } from '@/store/agentSignal';
import { initialState } from '@/store/agentSignal/initialState';

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

// Poll timing only: persistence is covered by `src/store/agentSignal/replica.test.ts`.
vi.mock('@/libs/swr', async () => {
  const swr = await import('swr');
  return { mutate: swr.mutate, useClientDataSWR: swr.default };
});

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
    useAgentSignalStore.setState({ ...initialState });
    const scope = crypto.randomUUID();
    vi.spyOn(cacheScope, 'get').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'use').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
    vi.spyOn(cacheScope, 'canHydrate').mockReturnValue(false);
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

  it('re-anchors steered continuation receipts under the original visible host group', async () => {
    vi.mocked(agentSignalService.listReceipts).mockResolvedValueOnce({
      cursor: undefined,
      receipts: [
        { ...receipt, anchorMessageId: 'assistant-group-2', id: 'receipt-continuation-group' },
        { ...receipt, anchorMessageId: 'assistant-child-2', id: 'receipt-continuation-child' },
        {
          ...receipt,
          anchorMessageId: undefined,
          id: 'receipt-continuation-trigger',
          triggerMessageId: 'steer-1',
        },
      ],
    });

    const { result } = renderReceiptsHook({
      agentId: 'agent-1',
      displayMessages: [
        message({ id: 'user-1', role: 'user' }),
        message({ id: 'assistant-group-1', parentId: 'user-1', role: 'assistantGroup' }),
        message({ id: 'steer-1', metadata: { steer: true }, role: 'user' }),
        message({
          children: [{ content: 'Final assistant step', id: 'assistant-child-2' }],
          id: 'assistant-group-2',
          parentId: 'steer-1',
          role: 'assistantGroup',
        }),
      ],
      enabled: true,
      topicId: 'topic-1',
    });

    await waitFor(() => {
      expect(result.current.receiptsByAnchor.get('assistant-group-1')).toEqual([
        expect.objectContaining({ id: 'receipt-continuation-group' }),
        expect.objectContaining({ id: 'receipt-continuation-child' }),
        expect.objectContaining({ id: 'receipt-continuation-trigger' }),
      ]);
    });
    expect(result.current.receiptsByAnchor.get('assistant-group-2')).toBeUndefined();
    expect(result.current.receiptsByAnchor.get('steer-1')).toBeUndefined();
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

    // Let the first request settle (it also writes the replica) before timing polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
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

    // Let the first request settle (it also writes the replica) before timing polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
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

    // Let the first request settle (it also writes the replica) before timing polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
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

    // Let the first request settle (it also writes the replica) before timing polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
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

  it('reads the full head again when a topic is reopened', async () => {
    vi.useFakeTimers();
    vi.mocked(agentSignalService.listReceipts).mockResolvedValue({
      cursor: undefined,
      receipts: [receipt],
    });

    const { rerender } = renderHook(
      ({ topicId }) =>
        useAgentSignalReceipts({
          agentId: 'agent-1',
          displayMessages: [],
          enabled: true,
          topicId,
        }),
      { initialProps: { topicId: 'topic-1' }, wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    rerender({ topicId: 'topic-2' });
    // Past the dedupe window, so reopening topic-1 requests at once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    vi.mocked(agentSignalService.listReceipts).mockClear();
    rerender({ topicId: 'topic-1' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // An Undo made elsewhere changes an older receipt, which a `sinceCreatedAt`
    // read would never return.
    expect(vi.mocked(agentSignalService.listReceipts).mock.calls[0]?.[0]).toEqual({
      agentId: 'agent-1',
      limit: 20,
      topicId: 'topic-1',
    });
  });

  it('keeps reconciling the full head when the reopen read fails', async () => {
    vi.useFakeTimers();
    vi.mocked(agentSignalService.listReceipts).mockResolvedValue({
      cursor: undefined,
      receipts: [receipt],
    });

    const { rerender } = renderHook(
      ({ topicId }) =>
        useAgentSignalReceipts({
          agentId: 'agent-1',
          displayMessages: [],
          enabled: true,
          topicId,
        }),
      { initialProps: { topicId: 'topic-1' }, wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ topicId: 'topic-2' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    vi.mocked(agentSignalService.listReceipts).mockClear();
    vi.mocked(agentSignalService.listReceipts).mockRejectedValueOnce(new Error('offline'));
    rerender({ topicId: 'topic-1' });
    // The reopen read fails, then SWR's error retry (2.5–7.5 s) runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    const calls = vi.mocked(agentSignalService.listReceipts).mock.calls.map(([input]) => input);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // The retry is a full head too, so an Undo made elsewhere still reaches this view.
    expect(calls[1]).toEqual({ agentId: 'agent-1', limit: 20, topicId: 'topic-1' });
  });
});
