import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordClientFactory } from './client';
import { validateDiscordCredentials } from './validateCredentials';

const APP_ID = '123456789012345678';
const credentials = {
  botToken: `${'a'.repeat(24)}.${'b'.repeat(6)}.${'c'.repeat(27)}`,
  publicKey: 'f'.repeat(64),
};

const MESSAGE_CONTENT = 1 << 19;
const MESSAGE_CONTENT_LIMITED = 1 << 18;

type Route = { body?: unknown; status?: number } | 'network-error';

const mockDiscord = (routes: Record<string, Route>) => {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const path = String(input).replace('https://discord.com/api/v10', '');
    const route = routes[path];
    if (!route || route === 'network-error') throw new Error('network down');
    const status = route.status ?? 200;
    return new Response(JSON.stringify(route.body ?? {}), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const healthyRoutes = (): Record<string, Route> => ({
  '/applications/@me': { body: { flags: MESSAGE_CONTENT_LIMITED, id: APP_ID } },
  '/users/@me': { body: { id: APP_ID } },
  '/users/@me/guilds?limit=1': { body: [{ id: '1' }] },
});

const codes = (result: Awaited<ReturnType<typeof validateDiscordCredentials>>) =>
  result.errors?.map((e) => e.code);

describe('validateDiscordCredentials', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes a bot that is installed and can read message content', async () => {
    mockDiscord(healthyRoutes());

    await expect(validateDiscordCredentials(credentials, APP_ID)).resolves.toEqual({ valid: true });
  });

  it('accepts the full (verified-app) Message Content flag too', async () => {
    mockDiscord({
      ...healthyRoutes(),
      '/applications/@me': { body: { flags: MESSAGE_CONTENT, id: APP_ID } },
    });

    await expect(validateDiscordCredentials(credentials, APP_ID)).resolves.toEqual({ valid: true });
  });

  it('reports a bot that has not been added to any server', async () => {
    mockDiscord({ ...healthyRoutes(), '/users/@me/guilds?limit=1': { body: [] } });

    const result = await validateDiscordCredentials(credentials, APP_ID);

    expect(result.valid).toBe(false);
    expect(codes(result)).toEqual(['bot_not_installed']);
  });

  it('reports Message Content Intent being off', async () => {
    mockDiscord({
      ...healthyRoutes(),
      '/applications/@me': { body: { flags: 0, id: APP_ID } },
    });

    const result = await validateDiscordCredentials(credentials, APP_ID);

    expect(result.valid).toBe(false);
    expect(codes(result)).toEqual(['message_content_intent_disabled']);
  });

  it('reports an Application ID that belongs to another app', async () => {
    mockDiscord(healthyRoutes());

    const result = await validateDiscordCredentials(credentials, '999999999999999999');

    expect(result.valid).toBe(false);
    expect(codes(result)).toEqual(['application_mismatch']);
    expect(result.errors?.[0].field).toBe('applicationId');
  });

  it('reports every setup gap at once', async () => {
    mockDiscord({
      ...healthyRoutes(),
      '/applications/@me': { body: { flags: 0, id: APP_ID } },
      '/users/@me/guilds?limit=1': { body: [] },
    });

    const result = await validateDiscordCredentials(credentials, APP_ID);

    expect(codes(result)).toEqual(['message_content_intent_disabled', 'bot_not_installed']);
  });

  it('marks a rejected token as invalid credentials and skips follow-up checks', async () => {
    const fetchMock = mockDiscord({ '/users/@me': { status: 401 } });

    const result = await validateDiscordCredentials(credentials, APP_ID);

    expect(codes(result)).toEqual(['invalid_credentials']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fail the bot when a follow-up lookup itself fails', async () => {
    mockDiscord({
      '/applications/@me': 'network-error',
      '/users/@me': { body: { id: APP_ID } },
      '/users/@me/guilds?limit=1': { status: 500 },
    });

    await expect(validateDiscordCredentials(credentials, APP_ID)).resolves.toEqual({ valid: true });
  });

  it('rejects malformed values before calling Discord', async () => {
    const fetchMock = mockDiscord({});

    const result = await validateDiscordCredentials({ botToken: 'nope', publicKey: 'xyz' }, APP_ID);

    expect(result.errors?.map((e) => e.field)).toEqual(['publicKey', 'botToken']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is what DiscordClientFactory.validateCredentials runs, with the application ID', async () => {
    mockDiscord({ ...healthyRoutes(), '/users/@me/guilds?limit=1': { body: [] } });

    const result = await new DiscordClientFactory().validateCredentials(
      credentials,
      {},
      APP_ID,
      'discord',
    );

    expect(codes(result)).toEqual(['bot_not_installed']);
  });
});
