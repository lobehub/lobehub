import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentGatewayUnavailableError, AgentStreamHistoryError } from '../../utils/agentStreamTransport';
import { followAgentRun } from './followRun';

const { getTrpcClient, historyQuery, streamAgentEvents } = vi.hoisted(() => {
  const historyQuery = vi.fn();
  return {
    getTrpcClient: vi.fn(async () => ({
      aiAgent: { getOperationStreamHistory: { query: historyQuery } },
    })),
    historyQuery,
    streamAgentEvents: vi.fn(),
  };
});

vi.mock('../../api/client', () => ({ getTrpcClient }));
vi.mock('../../api/http', () => ({ getAgentStreamAuthInfo: vi.fn() }));
vi.mock('../../settings', () => ({ resolveAgentGatewayUrl: () => 'https://gateway.test' }));
vi.mock('../../utils/agentStream', () => ({ streamAgentEvents }));
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
    streamAgentEvents.mockImplementation(async ({ readHistory }) => {
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
    streamAgentEvents.mockRejectedValue(new AgentStreamHistoryError('History expired'));

    await expect(followAgentRun('op-1')).resolves.toEqual({ kind: 'unknown' });
  });

  it('rethrows other failures so the caller can choose a fallback', async () => {
    streamAgentEvents.mockRejectedValue(new Error('boom'));

    await expect(followAgentRun('op-1')).rejects.toThrow('boom');
  });

  it('rethrows an exhausted gateway so the caller keeps polling the run status', async () => {
    streamAgentEvents.mockRejectedValue(
      new AgentGatewayUnavailableError('Reconnect attempts exhausted'),
    );

    await expect(followAgentRun('op-1')).rejects.toBeInstanceOf(AgentGatewayUnavailableError);
  });

  it('surfaces a server without the journal as a compatibility failure, not a lost history', async () => {
    historyQuery.mockRejectedValue(
      Object.assign(new Error('No procedure found on path "aiAgent.getOperationStreamHistory"'), {
        data: { code: 'NOT_FOUND' },
      }),
    );
    streamAgentEvents.mockImplementation(async ({ readHistory }) => {
      await readHistory('1-0', new AbortController().signal);
      return { kind: 'completed' };
    });

    await expect(followAgentRun('op-1')).rejects.toMatchObject({
      name: 'AgentJournalUnsupportedError',
    });
  });

  it('keeps an unknown operation id on the incomplete-history path', async () => {
    historyQuery.mockRejectedValue(
      Object.assign(new Error('Operation not found'), { data: { code: 'NOT_FOUND' } }),
    );
    // Mirror the transport: a non-compatibility read failure becomes a history failure.
    streamAgentEvents.mockImplementation(async ({ readHistory }) => {
      try {
        await readHistory('1-0', new AbortController().signal);
      } catch (error) {
        throw new AgentStreamHistoryError((error as Error).message);
      }
      return { kind: 'completed' };
    });

    await expect(followAgentRun('op-1')).resolves.toEqual({ kind: 'unknown' });
  });
});
