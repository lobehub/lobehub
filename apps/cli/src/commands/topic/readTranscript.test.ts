import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPERATION_TOKEN_REFUSAL } from '../../api/operationTokenFallback';
import { readTopicTranscript } from './readTranscript';

const jwt = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const trpcError = (message: string, code: string) =>
  new TRPCClientError(message, {
    result: { error: { code: -32_000, data: { code }, message } },
  } as any);

const query = { includeMessages: true, limit: 50, offset: 0, topicId: 'tpc_named0001' };
const transcript = { items: [], topic: { id: 'tpc_named0001' }, total: 0 };

const fakeClient = () => {
  const operationRoute = vi.fn();
  const userRoute = vi.fn();
  const client = {
    topic: {
      getTopicTranscript: { query: userRoute },
      getTopicTranscriptOperation: { query: operationRoute },
    },
  } as any;
  return { client, operationRoute, userRoute };
};

describe('readTopicTranscript', () => {
  const originalJwt = process.env.LOBEHUB_JWT;

  beforeEach(() => {
    process.env.LOBEHUB_JWT = jwt({ purpose: 'hetero-operation', sub: 'user-1' });
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.LOBEHUB_JWT;
    else process.env.LOBEHUB_JWT = originalJwt;
  });

  it("reads through the run's own operation route", async () => {
    const { client, operationRoute, userRoute } = fakeClient();
    operationRoute.mockResolvedValue(transcript);

    await expect(readTopicTranscript(client, query)).resolves.toBe(transcript);
    expect(operationRoute).toHaveBeenCalledWith(query);
    expect(userRoute).not.toHaveBeenCalled();
  });

  it('keeps an ordinary login on the ordinary route', async () => {
    process.env.LOBEHUB_JWT = jwt({ purpose: 'cli-sandbox', sub: 'user-1' });
    const { client, operationRoute, userRoute } = fakeClient();
    userRoute.mockResolvedValue(transcript);

    await expect(readTopicTranscript(client, query)).resolves.toBe(transcript);
    expect(operationRoute).not.toHaveBeenCalled();
  });

  it('sends an explicit --workspace to the ordinary route', async () => {
    const { client, operationRoute, userRoute } = fakeClient();
    userRoute.mockResolvedValue(transcript);

    await readTopicTranscript(client, query, 'ws-other');

    expect(operationRoute).not.toHaveBeenCalled();
    expect(userRoute).toHaveBeenCalledWith(query);
  });

  it('falls back to the ordinary route on a server without the operation route', async () => {
    const { client, operationRoute, userRoute } = fakeClient();
    operationRoute.mockRejectedValue(
      trpcError('No procedure found on path "topic.getTopicTranscriptOperation"', 'NOT_FOUND'),
    );
    userRoute.mockResolvedValue(transcript);

    await expect(readTopicTranscript(client, query)).resolves.toBe(transcript);
  });

  it('lets a same-account login read a topic outside the run’s boundary', async () => {
    const { client, operationRoute, userRoute } = fakeClient();
    operationRoute.mockRejectedValue(trpcError('outside this run', 'FORBIDDEN'));
    userRoute.mockResolvedValue(transcript);

    await expect(readTopicTranscript(client, query)).resolves.toBe(transcript);
  });

  it("explains the boundary when the ordinary route only repeats the token's refusal", async () => {
    const { client, operationRoute, userRoute } = fakeClient();
    operationRoute.mockRejectedValue(trpcError('outside this run', 'FORBIDDEN'));
    userRoute.mockRejectedValue(trpcError(OPERATION_TOKEN_REFUSAL, 'UNAUTHORIZED'));

    await expect(readTopicTranscript(client, query)).rejects.toThrow('outside this run');
  });

  it('reports a missing topic without retrying elsewhere', async () => {
    const { client, operationRoute, userRoute } = fakeClient();
    operationRoute.mockRejectedValue(trpcError('Topic not found: tpc_named0001', 'NOT_FOUND'));

    await expect(readTopicTranscript(client, query)).rejects.toThrow('Topic not found');
    expect(userRoute).not.toHaveBeenCalled();
  });

  it("shows the ordinary route's refusal when the server has no operation route", async () => {
    const { client, operationRoute, userRoute } = fakeClient();
    operationRoute.mockRejectedValue(
      trpcError('No procedure found on path "topic.getTopicTranscriptOperation"', 'NOT_FOUND'),
    );
    userRoute.mockRejectedValue(trpcError(OPERATION_TOKEN_REFUSAL, 'UNAUTHORIZED'));

    await expect(readTopicTranscript(client, query)).rejects.toThrow(OPERATION_TOKEN_REFUSAL);
  });
});
