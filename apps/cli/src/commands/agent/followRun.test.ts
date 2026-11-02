import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentGatewayUnavailableError,
  AgentStreamHistoryError,
} from '../../utils/agentStreamTransport';
import { followAgentRun } from './followRun';

const { getTrpcClient, globalConfigQuery, historyQuery, streamAgentEvents, userTokenQuery } =
  vi.hoisted(() => {
    const globalConfigQuery = vi.fn();
    const historyQuery = vi.fn();
    const userTokenQuery = vi.fn();
    return {
      getTrpcClient: vi.fn(async () => ({
        aiAgent: {
          getOperationStreamHistory: { query: historyQuery },
          issueGatewayUserToken: { query: userTokenQuery },
        },
        config: { getGlobalConfig: { query: globalConfigQuery } },
      })),
      globalConfigQuery,
      historyQuery,
      streamAgentEvents: vi.fn(),
      userTokenQuery,
    };
  });

vi.mock('../../api/client', () => ({ getTrpcClient }));
vi.mock('../../api/http', () => ({ getAgentStreamAuthInfo: vi.fn() }));
vi.mock('../../settings', () => ({
  normalizeUrl: (url?: string) => (url ? url.replace(/\/$/, '') : undefined),
  resolveAgentGatewayUrl: () => 'https://gateway.test',
}));
vi.mock('../../utils/agentStream', () => ({ streamAgentEvents }));
vi.mock('../../utils/logger', () => ({ log: { debug: vi.fn(), error: vi.fn() } }));

describe('followAgentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyQuery.mockResolvedValue({
      available: true,
      events: [],
      hasMore: false,
      nextCursor: '0',
    });
    globalConfigQuery.mockResolvedValue({
      serverConfig: { agentGatewayProtocol: 1, agentGatewayUrl: 'https://gateway.test' },
    });
    streamAgentEvents.mockResolvedValue({ kind: 'completed', status: 'done' });
  });

  describe('gateway protocol', () => {
    const streamedWith = () => streamAgentEvents.mock.calls[0][0];

    it('follows over /v2/ws, minting a user token per dial, when the server Gateway serves protocol 2', async () => {
      globalConfigQuery.mockResolvedValue({
        serverConfig: { agentGatewayProtocol: 2, agentGatewayUrl: 'https://gateway.test/' },
      });
      userTokenQuery
        .mockResolvedValueOnce({ token: 'jwt-1' })
        .mockResolvedValueOnce({ token: 'jwt-2' });

      await followAgentRun('op-1');

      const { getGatewayUserToken } = streamedWith();
      await expect(getGatewayUserToken()).resolves.toBe('jwt-1');
      await expect(getGatewayUserToken()).resolves.toBe('jwt-2');
    });

    it('stays on /ws for a protocol-1 (self-hosted) Gateway', async () => {
      await followAgentRun('op-1');

      expect(streamedWith().getGatewayUserToken).toBeUndefined();
    });

    it('stays on /ws when the CLI points at a different Gateway than the server advertises', async () => {
      globalConfigQuery.mockResolvedValue({
        serverConfig: { agentGatewayProtocol: 2, agentGatewayUrl: 'https://other-gateway.test' },
      });

      await followAgentRun('op-1');

      expect(streamedWith().getGatewayUserToken).toBeUndefined();
    });

    it('stays on /ws when the capability lookup fails', async () => {
      globalConfigQuery.mockRejectedValue(new Error('fetch failed'));

      await followAgentRun('op-1');

      expect(streamedWith().getGatewayUserToken).toBeUndefined();
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
