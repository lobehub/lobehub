import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSignalService } from '@/services/agentSignal';

import { useAgentSignalReceipts } from './useAgentSignalReceipts';

vi.mock('@/services/agentSignal', () => ({
  agentSignalService: {
    listReceipts: vi.fn().mockResolvedValue({
      cursor: undefined,
      receipts: [{ anchorMessageId: 'assistant-1', id: 'receipt-1', kind: 'memory' }],
    }),
  },
}));

describe('useAgentSignalReceipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups receipts by anchor and keeps unanchored receipts separate', async () => {
    const { result } = renderHook(() =>
      useAgentSignalReceipts({ agentId: 'agent-1', enabled: true, topicId: 'topic-1' }),
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
    renderHook(() =>
      useAgentSignalReceipts({ agentId: 'agent-1', enabled: false, topicId: 'topic-1' }),
    );

    expect(agentSignalService.listReceipts).not.toHaveBeenCalled();
  });
});
