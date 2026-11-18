// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appEnv = vi.hoisted(() => ({
  AGENT_GATEWAY_INTERNAL_URL: undefined as string | undefined,
  AGENT_GATEWAY_SERVICE_TOKEN: 'service-token' as string | undefined,
  AGENT_GATEWAY_URL: 'https://gateway.test' as string | undefined,
}));
vi.mock('@/envs/app', () => ({ appEnv }));

const { notifyUsers } = await import('./notify');

describe('notifyUsers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    appEnv.AGENT_GATEWAY_INTERNAL_URL = undefined;
    appEnv.AGENT_GATEWAY_SERVICE_TOKEN = 'service-token';
    appEnv.AGENT_GATEWAY_URL = 'https://gateway.test';
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts the topic and each user once to the gateway user feed', async () => {
    await notifyUsers('contacts', ['a', 'b', 'a', '']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://gateway.test/api/users/notify');
    expect(init.headers.Authorization).toBe('Bearer service-token');
    expect(JSON.parse(init.body)).toEqual({ topic: 'contacts', userIds: ['a', 'b'] });
  });

  it('prefers the internal gateway URL', async () => {
    appEnv.AGENT_GATEWAY_INTERNAL_URL = 'http://gateway.internal';
    await notifyUsers('contacts', ['a']);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://gateway.internal/api/users/notify');
  });

  it('sends more than 500 users in batches', async () => {
    await notifyUsers(
      'contacts',
      Array.from({ length: 501 }, (_, i) => `u${i}`),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).userIds).toEqual(['u500']);
  });

  it('does nothing without a gateway, a token or anyone to tell', async () => {
    appEnv.AGENT_GATEWAY_SERVICE_TOKEN = undefined;
    await notifyUsers('contacts', ['a']);
    appEnv.AGENT_GATEWAY_SERVICE_TOKEN = 'service-token';
    await notifyUsers('contacts', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the gateway fails or is too old', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    await expect(notifyUsers('contacts', ['a'])).resolves.toBeUndefined();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(notifyUsers('contacts', ['a'])).resolves.toBeUndefined();
  });
});
