import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from './lambda';

vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/services/_auth', () => ({ createHeaderWithAuth: async () => ({}) }));
vi.mock('@/business/client/trpc-headers', () => ({ getBusinessTrpcHeaders: async () => ({}) }));

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
