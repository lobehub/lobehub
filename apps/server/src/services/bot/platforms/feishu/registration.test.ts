import { gunzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_BOT_APP_ADDONS,
  beginFeishuAppRegistration,
  encodeAppAddons,
  pollFeishuAppRegistration,
} from './registration';

const respond = (body: unknown, status = 200) =>
  ({ json: async () => body, status }) as unknown as Response;

const decodeAddons = (value: string) =>
  JSON.parse(
    gunzipSync(Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64')).toString(),
  );

describe('Feishu app registration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('encodes addons as gzip + base64url without padding', () => {
    const encoded = encodeAppAddons(AGENT_BOT_APP_ADDONS);

    expect(encoded).toMatch(/^[\w-]+$/);
    expect(decodeAddons(encoded)).toEqual(AGENT_BOT_APP_ADDONS);
  });

  it('begins on Feishu and builds a create-only link with the preset and addons', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respond({
        device_code: 'dc',
        expires_in: 3600,
        interval: 5,
        verification_uri_complete: 'https://open.feishu.cn/page/launcher?user_code=AB-CD',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await beginFeishuAppRegistration({ desc: 'Team bot', name: 'Moss' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://accounts.feishu.cn/oauth/v1/app/registration');
    expect(fetchMock.mock.calls[0][1].body).toContain('action=begin');
    const url = new URL(result.url);
    expect(url.searchParams.get('user_code')).toBe('AB-CD');
    expect(url.searchParams.get('createOnly')).toBe('true');
    expect(url.searchParams.get('name')).toBe('Moss');
    expect(decodeAddons(url.searchParams.get('addons')!).events.items.tenant).toContain(
      'im.message.receive_v1',
    );
    expect(result).toMatchObject({ deviceCode: 'dc', expiresIn: 3600, interval: 5 });
  });

  it('reports pending, slow down, denied and expired polls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond({ error: 'authorization_pending' }, 400))
      .mockResolvedValueOnce(respond({ error: 'slow_down' }, 400))
      .mockResolvedValueOnce(respond({ error: 'access_denied', error_description: 'no' }, 400))
      .mockResolvedValueOnce(respond({ error: 'expired_token' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    expect(await pollFeishuAppRegistration('dc')).toEqual({ brand: 'feishu', status: 'pending' });
    expect(await pollFeishuAppRegistration('dc')).toEqual({
      brand: 'feishu',
      slowDown: true,
      status: 'pending',
    });
    expect(await pollFeishuAppRegistration('dc')).toEqual({ message: 'no', status: 'denied' });
    expect((await pollFeishuAppRegistration('dc')).status).toBe('expired');
  });

  it('switches to the Lark domain for a Lark tenant and returns the credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond({ user_info: { tenant_brand: 'lark' } }))
      .mockResolvedValueOnce(
        respond({
          client_id: 'cli_1',
          client_secret: 'secret',
          user_info: { open_id: 'ou_1', tenant_brand: 'lark' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await pollFeishuAppRegistration('dc');

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://accounts.larksuite.com/oauth/v1/app/registration',
    );
    expect(result).toEqual({
      appId: 'cli_1',
      appSecret: 'secret',
      brand: 'lark',
      openId: 'ou_1',
      status: 'success',
    });
  });
});
