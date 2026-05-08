// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Imported after the mock so the middleware picks up the stubbed verifier.
import { qstashAuth } from '../qstashAuth';

const mockVerify = vi.fn<(req: Request, body: string) => Promise<boolean>>();
vi.mock('@/libs/qstash', () => ({
  verifyQStashSignature: (req: Request, body: string) => mockVerify(req, body),
}));

function buildContext(rawBody: string) {
  const rawRequest = new Request('http://x/api/agent/run', {
    method: 'POST',
    body: rawBody,
  });
  let captured: { body: any; status: number } | undefined;
  const ctx = {
    json: (b: any, status = 200) => {
      captured = { body: b, status };
      return Response.json(b, { status });
    },
    req: {
      path: '/api/agent/run',
      raw: rawRequest,
      text: async () => rawBody,
    },
  } as any;
  return { ctx, getCaptured: () => captured };
}

describe('qstashAuth middleware', () => {
  beforeEach(() => {
    mockVerify.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes the raw body and request to verifyQStashSignature', async () => {
    mockVerify.mockResolvedValue(true);
    const next = vi.fn().mockResolvedValue(undefined);
    const { ctx } = buildContext('{"hello":"world"}');

    await qstashAuth()(ctx, next);

    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith(ctx.req.raw, '{"hello":"world"}');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects with 401 when signature is invalid', async () => {
    mockVerify.mockResolvedValue(false);
    const next = vi.fn();
    const { ctx, getCaptured } = buildContext('{"hello":"world"}');

    const res = await qstashAuth()(ctx, next);

    expect(res?.status).toBe(401);
    expect(getCaptured()?.body).toEqual({ error: 'Invalid signature' });
    expect(next).not.toHaveBeenCalled();
  });
});
