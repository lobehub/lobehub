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

describe('lambdaClient transport lanes', () => {
  const fetchMock = vi.fn();

  // A batched request expects an array body with one entry per operation in it
  // (the procedures are comma-joined in the path); an unbatched one expects the
  // plain result object. Answering both shapes keeps a wrongly-shared batch from
  // failing as a transport error instead of the assertion that describes it.
  const respondByLane = (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('batch=1')) return Promise.resolve(okTrpcResponse(null));

    const procedures = url.split('/trpc/lambda/')[1]?.split('?')[0]?.split(',') ?? [''];
    return Promise.resolve(
      new Response(
        JSON.stringify(procedures.map(() => ({ result: { data: superjson.serialize(null) } }))),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    );
  };

  const requestedUrls = () =>
    fetchMock.mock.calls.map(([input]) => String(input as RequestInfo | URL));

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('http://localhost/chat'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  // Regression: every `device.*` read hops from the server to one of the user's
  // own machines and is capped by a 10-60s RPC timeout. Batched with ordinary
  // lambda reads, one sleeping laptop held the whole batch's response — opening a
  // topic with a working directory fires several such hops at once, which is what
  // made an obviously-live run render as idle after a topic switch.
  it('keeps device.* hops out of the batch carrying ordinary lambda reads', async () => {
    fetchMock.mockImplementation(respondByLane);

    await Promise.all([
      lambdaClient.device.gitBranch.query({ deviceId: 'dev_1', path: '/repo' }),
      lambdaClient.agent.getAgentConfigById.query({ agentId: 'agt_test' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = requestedUrls();
    expect(
      urls.some(
        (url) => url.includes('device.gitBranch') && !url.includes('agent.getAgentConfigById'),
      ),
    ).toBe(true);
    expect(
      urls.some(
        (url) => url.includes('agent.getAgentConfigById') && !url.includes('device.gitBranch'),
      ),
    ).toBe(true);
  });

  // The gateway reconnect cannot register its local operation — and so cannot
  // show the status tray, the sidebar elapsed time or the stop button — until
  // this token comes back. It is a cheap read; it must never queue behind a
  // slower sibling in the shared batch.
  it('sends the gateway token refresh as its own unbatched request', async () => {
    fetchMock.mockImplementation(respondByLane);

    await Promise.all([
      lambdaClient.aiAgent.refreshGatewayToken.query({ topicId: 'tpc_1' }),
      lambdaClient.agent.getAgentConfigById.query({ agentId: 'agt_test' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenUrl = requestedUrls().find((url) => url.includes('aiAgent.refreshGatewayToken'));
    expect(tokenUrl).toBeDefined();
    expect(tokenUrl).not.toContain('batch=1');
    expect(tokenUrl).not.toContain('agent.getAgentConfigById');
  });
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
