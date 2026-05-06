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

describe('useAgentSignalReceipts', () => {
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('groups receipts by anchor and keeps unanchored receipts separate', async () => {
    const { result } = renderHook(
      () => useAgentSignalReceipts({ agentId: 'agent-1', enabled: true, topicId: 'topic-1' }),
      { wrapper },
    );

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

  it('does not fetch receipts when the feature flag is disabled', async () => {
    renderHook(
      () => useAgentSignalReceipts({ agentId: 'agent-1', enabled: false, topicId: 'topic-1' }),
      { wrapper },
    );

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

    renderHook(
      () => useAgentSignalReceipts({ agentId: 'agent-1', enabled: true, topicId: 'topic-1' }),
      { wrapper },
    );

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
});
