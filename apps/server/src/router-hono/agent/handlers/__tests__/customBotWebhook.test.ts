// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findByIds, getWebhookHandler, innerHandler } = vi.hoisted(() => {
  const innerHandler = vi.fn();
  return {
    findByIds: vi.fn(),
    getWebhookHandler: vi.fn(() => innerHandler),
    innerHandler,
  };
});

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: { findByIds },
}));
vi.mock('@/server/services/bot', () => ({
  getBotMessageRouter: () => ({ getWebhookHandler }),
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));

const { customBotWebhook } = await import('../customBotWebhook');

const ROW_ID = '3f2b6c1e-8d4a-4b6e-9c1f-2a7d5e8b9c0d';

const context = (botId: string | undefined) => {
  const raw = new Request(`https://lobehub.test/api/agent/webhooks/custom/${botId}`, {
    body: '{}',
    method: 'POST',
  });
  return {
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    req: { param: () => botId, raw },
  } as any;
};

beforeEach(() => {
  findByIds.mockReset();
  getWebhookHandler.mockClear();
  innerHandler.mockReset();
  innerHandler.mockResolvedValue(new Response('ok'));
});

describe('customBotWebhook', () => {
  it('routes a Bot ID straight to the webhook platform adapter', async () => {
    const ctx = context('my-bot');

    const res = await customBotWebhook(ctx);

    expect(res.status).toBe(200);
    expect(findByIds).not.toHaveBeenCalled();
    expect(getWebhookHandler).toHaveBeenCalledWith('webhook', 'my-bot');
    expect(innerHandler).toHaveBeenCalledWith(ctx.req.raw, expect.any(Object));
  });

  it('resolves a REST bot id (UUID) to its Bot ID', async () => {
    findByIds.mockResolvedValue([{ applicationId: 'my-bot', platform: 'webhook' }]);

    await customBotWebhook(context(ROW_ID));

    expect(findByIds).toHaveBeenCalledWith(expect.anything(), [ROW_ID]);

    // The mapping itself is the point of this case: the row's Bot ID, not the UUID, reaches the adapter.
    const [platform, applicationId] = getWebhookHandler.mock.calls[0] as unknown as [
      string,
      string,
    ];
    expect(platform).toBe('webhook');
    expect(applicationId).toBe('my-bot');
  });

  it('answers 404 for the id of a bot on another platform', async () => {
    findByIds.mockResolvedValue([{ applicationId: '123', platform: 'telegram' }]);

    const res = await customBotWebhook(context(ROW_ID));

    expect(res.status).toBe(404);
    expect(getWebhookHandler).not.toHaveBeenCalled();
  });
});
