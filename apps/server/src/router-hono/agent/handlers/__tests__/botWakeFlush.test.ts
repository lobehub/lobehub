// @vitest-environment node
import { Hono } from 'hono';

import { botWakeFlush } from '../botWakeFlush';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  handleWakeFlush: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: { findEnabledByPlatformAndAppId: mocks.find },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));
vi.mock('@/server/services/bot/wake/scheduler', () => ({ handleWakeFlush: mocks.handleWakeFlush }));

const app = new Hono().post('/flush', botWakeFlush);
const post = (body: unknown) =>
  app.request('/flush', { body: JSON.stringify(body), method: 'POST' });
const payload = { applicationId: 'app', at: 1, channelKey: 'discord:app:g:c', platform: 'discord' };

describe('botWakeFlush', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    null,
    {},
    { payload: { applicationId: 'app' } },
    { payload: { ...payload, at: 'soon' } },
  ])('rejects an invalid payload %j with 400', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.handleWakeFlush).not.toHaveBeenCalled();
  });

  it('flushes and loads the bot settings through the provider model', async () => {
    mocks.find.mockResolvedValue({ settings: { botWake: { enabled: true } }, userId: 'owner' });
    mocks.handleWakeFlush.mockImplementation(async (_payload, load) => {
      expect(await load('discord', 'app')).toEqual({
        settings: { botWake: { enabled: true } },
      });
    });

    const response = await post({ payload });

    expect(response.status).toBe(200);
    expect(mocks.handleWakeFlush).toHaveBeenCalledWith(payload, expect.any(Function));
    expect(mocks.find).toHaveBeenCalledWith(expect.anything(), 'discord', 'app', expect.anything());
  });

  it('hands the flush no provider when the bot is gone', async () => {
    mocks.find.mockResolvedValue(null);
    mocks.handleWakeFlush.mockImplementation(async (_payload, load) => {
      expect(await load('discord', 'app')).toBeUndefined();
    });

    expect((await post({ payload })).status).toBe(200);
  });

  it('answers 500 so the queue redelivers when the flush fails', async () => {
    mocks.handleWakeFlush.mockRejectedValue(new Error('redis down'));

    expect((await post({ payload })).status).toBe(500);
  });
});
