import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from './lambda';

vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/services/_auth', () => ({ createHeaderWithAuth: async () => ({}) }));
vi.mock('@/business/client/trpc-headers', () => ({ getBusinessTrpcHeaders: async () => ({}) }));
// i18next is never initialised in this suite, so `t` echoes the key — assertions
// below check which copy was selected, not its wording.
vi.mock('i18next', () => ({ t: (key: string) => key }));

const okTrpcResponse = (data: unknown) =>
  new Response(JSON.stringify({ result: { data: superjson.serialize(data) } }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });

describe('lambdaClient large-input query transport', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('http://localhost/chat'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  // Regression: the visible-topic candidate set (up to 1000 ids) blows the
  // httpBatchLink GET URL budget (maxURLLength 2083) and used to be rejected
  // client-side with "Input is too big for a single dispatch" before any
  // request was made. These procedures must go over POST instead.
  it.each([
    [
      'agent.getTransferJobStatus',
      () =>
        lambdaClient.agent.getTransferJobStatus.query({
          agentId: 'agt_test',
          topicIds: Array.from({ length: 1000 }, (_, i) => `tpc_${String(i).padStart(16, '0')}`),
        }),
      'topicIds',
      1000,
    ],
    [
      'group.getTransferJobStatus',
      () =>
        lambdaClient.group.getTransferJobStatus.query({
          groupId: 'grp_test',
          topicIds: Array.from({ length: 1000 }, (_, i) => `tpc_${String(i).padStart(16, '0')}`),
        }),
      'topicIds',
      1000,
    ],
  ] as const)(
    'sends %s with a large path/id array as a POST request',
    async (path, call, arrayField, expectedLength) => {
      fetchMock.mockResolvedValueOnce(okTrpcResponse(null));

      await expect(call()).resolves.toBeNull();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
      expect(init.method).toBe('POST');
      // The input travels in the body, not the query string.
      expect(String(input)).toContain(`/trpc/lambda/${path}`);
      expect(String(input).length).toBeLessThan(2083);
      const body = JSON.parse(String(init.body)) as { json: Record<string, unknown[]> };
      expect(body.json[arrayField]).toHaveLength(expectedLength);
    },
  );
});

describe('lambdaClient unreadable response handling', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('http://localhost/chat'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  // Regression: a JSON body that is not a `TRPCResponse` makes @trpc/client
  // throw `TransformResultError`, and its internal message used to reach the
  // UI — the agent-config alert above the chat input rendered "Unable to
  // transform response from server" while the desktop app was simply offline.
  it('replaces the transform error with the diagnosed network copy', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          body: { detail: 'net::ERR_CONNECTION_REFUSED' },
          errorType: 'RemoteServerConnectionRefused',
        }),
        { headers: { 'content-type': 'application/json' }, status: 502 },
      ),
    );

    await expect(
      lambdaClient.agent.getAgentConfigById.query({ agentId: 'agt_test' }),
    ).rejects.toThrow('response.RemoteServerConnectionRefused');
  });

  it('falls back to generic copy for foreign JSON without a known error type', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Forbidden' }), {
        headers: { 'content-type': 'application/json' },
        status: 403,
      }),
    );

    await expect(
      lambdaClient.agent.getAgentConfigById.query({ agentId: 'agt_test' }),
    ).rejects.toThrow('response.UnreadableServerResponse');
  });

  it('keeps a well-formed tRPC error message untouched', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: superjson.serialize({
            code: -32_600,
            data: { code: 'BAD_REQUEST', httpStatus: 400 },
            message: 'agentId is required',
          }),
        }),
        { headers: { 'content-type': 'application/json' }, status: 400 },
      ),
    );

    await expect(
      lambdaClient.agent.getAgentConfigById.query({ agentId: 'agt_test' }),
    ).rejects.toThrow('agentId is required');
  });
});
