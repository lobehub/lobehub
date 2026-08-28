// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { platformWebhook } from '../platformWebhook';

const { mockGetWebhookHandler, mockGetBotMessageRouter } = vi.hoisted(() => {
  const handler = vi.fn();
  return {
    mockGetBotMessageRouter: vi.fn(() => ({ getWebhookHandler: handler })),
    mockGetWebhookHandler: handler,
  };
});

vi.mock('@/server/services/bot', () => ({
  getBotMessageRouter: mockGetBotMessageRouter,
}));

function buildContext(opts: { params: Record<string, string | undefined>; url?: string }) {
  const rawRequest = new Request(opts.url ?? 'http://x/api/agent/webhooks/telegram/app-1', {
    method: 'POST',
    body: '{}',
  });
  const captures: Array<{ body: any; status: number }> = [];
  const ctx = {
    json: (b: any, status = 200) => {
      captures.push({ body: b, status });
      return Response.json(b, { status });
    },
    req: {
      param: (name: string) => opts.params[name],
      raw: rawRequest,
      url: rawRequest.url,
    },
  } as any;
  return { ctx, getCaptures: () => captures, rawRequest };
}

describe('platformWebhook handler', () => {
  beforeEach(() => {
    mockGetWebhookHandler.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when platform param is missing', async () => {
    const { ctx, getCaptures } = buildContext({ params: { platform: undefined } });

    const res = await platformWebhook(ctx);

    expect(res.status).toBe(400);
    expect(getCaptures()[0].body).toEqual({ error: 'platform is required' });
    expect(mockGetWebhookHandler).not.toHaveBeenCalled();
  });

  it('forwards platform + appId + raw request to the bot message router', async () => {
    const platformResponse = new Response('ok', { status: 202 });
    const innerHandler = vi.fn().mockResolvedValue(platformResponse);
    mockGetWebhookHandler.mockReturnValue(innerHandler);

    const { ctx, rawRequest } = buildContext({
      params: { appId: 'app-1', platform: 'telegram' },
    });

    const res = await platformWebhook(ctx);

    expect(res).toBe(platformResponse);
    expect(mockGetWebhookHandler).toHaveBeenCalledWith('telegram', 'app-1');
    // Platform-side signature verification depends on the original Request,
    // so the handler must receive `c.req.raw` verbatim.
    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(innerHandler.mock.calls[0][0]).toBe(rawRequest);
  });

  it('passes appId=undefined when only platform is provided', async () => {
    mockGetWebhookHandler.mockImplementation(() => async () => new Response(null, { status: 204 }));

    const { ctx } = buildContext({
      params: { platform: 'discord' },
      url: 'http://x/api/agent/webhooks/discord',
    });

    await platformWebhook(ctx);

    expect(mockGetWebhookHandler).toHaveBeenCalledWith('discord', undefined);
  });
});
