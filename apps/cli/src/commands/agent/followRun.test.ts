import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStreamHistoryError } from '../../utils/agentStreamTransport';
import { followAgentRun } from './followRun';

const { getTrpcClient, historyQuery, streamAgentEventsViaWebSocket } = vi.hoisted(() => {
  const historyQuery = vi.fn();
  return {
    getTrpcClient: vi.fn(async () => ({
      aiAgent: { getOperationStreamHistory: { query: historyQuery } },
    })),
    historyQuery,
    streamAgentEventsViaWebSocket: vi.fn(),
  };
});

vi.mock('../../api/client', () => ({ getTrpcClient }));
vi.mock('../../api/http', () => ({ getAgentStreamAuthInfo: vi.fn() }));
vi.mock('../../settings', () => ({ resolveAgentGatewayUrl: () => 'https://gateway.test' }));
vi.mock('../../utils/agentStream', () => ({ streamAgentEventsViaWebSocket }));
vi.mock('../../utils/logger', () => ({ log: { error: vi.fn() } }));

describe('followAgentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyQuery.mockResolvedValue({
      available: true,
      events: [],
      hasMore: false,
      nextCursor: '0',
    });
  });

  it('reads history pages through the credential-refreshing tRPC client', async () => {
    streamAgentEventsViaWebSocket.mockImplementation(async ({ readHistory }) => {
      await readHistory('1-0', new AbortController().signal);
      return { kind: 'completed', status: 'done' };
    });

    await expect(followAgentRun('op-1')).resolves.toEqual({ kind: 'completed', status: 'done' });

    expect(getTrpcClient).toHaveBeenCalled();
    expect(historyQuery).toHaveBeenCalledWith(
      { cursor: '1-0', operationId: 'op-1' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('resolves an incomplete history as an unknown outcome, never a success', async () => {
    streamAgentEventsViaWebSocket.mockRejectedValue(new AgentStreamHistoryError('History expired'));

    await expect(followAgentRun('op-1')).resolves.toEqual({ kind: 'unknown' });
  });

  it('rethrows other failures so the caller can choose a fallback', async () => {
    streamAgentEventsViaWebSocket.mockRejectedValue(new Error('boom'));

    await expect(followAgentRun('op-1')).rejects.toThrow('boom');
  });
});
