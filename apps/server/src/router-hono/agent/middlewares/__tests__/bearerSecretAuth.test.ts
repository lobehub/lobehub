// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bearerSecretAuth } from '../bearerSecretAuth';

function buildContext(authHeader?: string) {
  let captured: { body: any; status: number } | undefined;
  const ctx = {
    json: (b: any, status = 200) => {
      captured = { body: b, status };
      return Response.json(b, { status });
    },
    req: {
      header: (name: string) => (name.toLowerCase() === 'authorization' ? authHeader : undefined),
      path: '/api/agent/gateway',
    },
  } as any;
  return { ctx, getCaptured: () => captured };
}

describe('bearerSecretAuth middleware', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when the secret is unset', async () => {
    const next = vi.fn();
    const { ctx, getCaptured } = buildContext('Bearer anything');

    const res = await bearerSecretAuth(() => undefined)(ctx, next);

    expect(res?.status).toBe(503);
    expect(getCaptured()?.body).toEqual({ error: 'Service not configured' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the authorization header is missing', async () => {
    const next = vi.fn();
    const { ctx, getCaptured } = buildContext(undefined);

    const res = await bearerSecretAuth(() => 'shh')(ctx, next);

    expect(res?.status).toBe(401);
    expect(getCaptured()?.body).toEqual({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the authorization header does not match', async () => {
    const next = vi.fn();
    const { ctx } = buildContext('Bearer wrong');

    const res = await bearerSecretAuth(() => 'shh')(ctx, next);

    expect(res?.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the bearer token matches', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const { ctx } = buildContext('Bearer shh');

    await bearerSecretAuth(() => 'shh')(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('evaluates the secret getter on each request (no cache)', async () => {
    const getSecret = vi.fn();
    getSecret.mockReturnValueOnce(undefined).mockReturnValueOnce('s');

    const mw = bearerSecretAuth(getSecret);

    // first call: secret unset → 503
    const first = await mw(buildContext('Bearer s').ctx, vi.fn());
    expect(first?.status).toBe(503);

    // second call: secret now set → 200/next
    const next = vi.fn().mockResolvedValue(undefined);
    await mw(buildContext('Bearer s').ctx, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(getSecret).toHaveBeenCalledTimes(2);
  });
});
