import { describe, expect, it, vi } from 'vitest';

import {
  deviceGatewayServerKey,
  normalizeDeviceGatewayUrl,
  parseDeviceGatewayDiscovery,
  resolveDeviceGatewayEndpoint,
  toDeviceGatewayWebSocketUrl,
} from './endpoint';

const OFFICIAL = 'https://device-gateway.lobehub.com';

describe('normalizeDeviceGatewayUrl', () => {
  it('keeps a path prefix and drops trailing slashes', () => {
    expect(normalizeDeviceGatewayUrl(' https://Gateway.example.com:443/edge/gw// ')).toBe(
      'https://gateway.example.com/edge/gw',
    );
    expect(normalizeDeviceGatewayUrl('http://localhost:8788/')).toBe('http://localhost:8788');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['null', null],
    ['not a URL', 'device-gateway'],
    ['websocket scheme', 'wss://gateway.example.com'],
    ['credentials', 'https://user:secret@gateway.example.com'],
    ['query', 'https://gateway.example.com/?token=abc'],
    ['empty query', 'https://gateway.example.com/?'],
    ['fragment', 'https://gateway.example.com/#x'],
  ])('rejects %s', (_label, value) => {
    expect(normalizeDeviceGatewayUrl(value)).toBeUndefined();
  });
});

describe('deviceGatewayServerKey', () => {
  it('treats trailing slashes and default ports as the same server', () => {
    expect(deviceGatewayServerKey('https://lobe.example.com:443/')).toBe(
      deviceGatewayServerKey('https://lobe.example.com'),
    );
  });

  it('keeps distinct hosts and ports apart', () => {
    expect(deviceGatewayServerKey('http://localhost:3010')).not.toBe(
      deviceGatewayServerKey('http://localhost:3020'),
    );
  });
});

describe('toDeviceGatewayWebSocketUrl', () => {
  it('appends /ws under the path prefix', () => {
    expect(toDeviceGatewayWebSocketUrl('https://example.com/edge/gw').toString()).toBe(
      'wss://example.com/edge/gw/ws',
    );
    expect(toDeviceGatewayWebSocketUrl('http://localhost:8788/').toString()).toBe(
      'ws://localhost:8788/ws',
    );
  });
});

describe('parseDeviceGatewayDiscovery', () => {
  it('reads an advertised address', () => {
    expect(
      parseDeviceGatewayDiscovery({
        serverConfig: { deviceGatewayUrl: 'https://gw.example.com/' },
      }),
    ).toEqual({ status: 'advertised', url: 'https://gw.example.com' });
  });

  it('treats an omitted field as absent', () => {
    expect(
      parseDeviceGatewayDiscovery({ serverConfig: { enableUploadFileToServer: true } }),
    ).toEqual({ status: 'absent' });
  });

  it.each([
    ['null', null],
    ['empty string', ''],
    ['non-http scheme', 'ftp://gw.example.com'],
    ['number', 42],
  ])('flags a %s advertisement as invalid instead of absent', (_label, value) => {
    expect(parseDeviceGatewayDiscovery({ serverConfig: { deviceGatewayUrl: value } }).status).toBe(
      'invalid',
    );
  });

  it.each([
    ['undefined', undefined],
    ['an HTML error page', '<html>404</html>'],
    ['a body without serverConfig', { billboard: null }],
  ])('flags %s as a failed discovery', (_label, value) => {
    expect(parseDeviceGatewayDiscovery(value).status).toBe('failed');
  });
});

describe('resolveDeviceGatewayEndpoint', () => {
  const advertised = async () => ({ status: 'advertised', url: 'https://gw.example.com' }) as const;

  it('uses an explicit override without asking the server', async () => {
    const discover = vi.fn(advertised);

    await expect(
      resolveDeviceGatewayEndpoint({
        discover,
        manualUrl: 'https://gw.saved.example',
        officialGatewayUrl: OFFICIAL,
        override: 'http://localhost:8787/',
      }),
    ).resolves.toEqual({
      endpoint: { source: 'override', url: 'http://localhost:8787' },
      ok: true,
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it('rejects an invalid override instead of falling through', async () => {
    const discover = vi.fn(advertised);

    await expect(
      resolveDeviceGatewayEndpoint({
        discover,
        manualUrl: 'https://gw.saved.example',
        override: 'wss://gw.example.com',
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'invalid_override' });
    expect(discover).not.toHaveBeenCalled();
  });

  it('prefers the address saved for this server over the advertised one, without asking', async () => {
    const discover = vi.fn(advertised);

    await expect(
      resolveDeviceGatewayEndpoint({
        discover,
        manualUrl: 'https://gw.saved.example/',
        officialGatewayUrl: OFFICIAL,
      }),
    ).resolves.toEqual({
      endpoint: { source: 'manual', url: 'https://gw.saved.example' },
      ok: true,
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it('keeps a saved address that equals the official gateway as the saved choice', async () => {
    const discover = vi.fn(advertised);

    await expect(
      resolveDeviceGatewayEndpoint({ discover, manualUrl: OFFICIAL, officialGatewayUrl: OFFICIAL }),
    ).resolves.toEqual({ endpoint: { source: 'manual', url: OFFICIAL }, ok: true });
    expect(discover).not.toHaveBeenCalled();
  });

  it('reports an invalid saved address instead of discovering around it', async () => {
    const discover = vi.fn(advertised);

    await expect(
      resolveDeviceGatewayEndpoint({
        discover,
        manualUrl: 'ftp://gw',
        officialGatewayUrl: OFFICIAL,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'invalid_manual' });
    expect(discover).not.toHaveBeenCalled();
  });

  it('uses the advertised address when nothing is configured', async () => {
    await expect(
      resolveDeviceGatewayEndpoint({
        discover: async () => ({ status: 'advertised', url: 'https://gw.example.com/prefix' }),
        manualUrl: '  ',
        officialGatewayUrl: OFFICIAL,
      }),
    ).resolves.toEqual({
      endpoint: { source: 'server', url: 'https://gw.example.com/prefix' },
      ok: true,
    });
  });

  it('defaults to the official gateway only when the server answered without one', async () => {
    await expect(
      resolveDeviceGatewayEndpoint({
        discover: async () => ({ status: 'absent' }),
        officialGatewayUrl: OFFICIAL,
      }),
    ).resolves.toEqual({ endpoint: { source: 'official', url: OFFICIAL }, ok: true });
  });

  it('reports not_configured when the caller has no default for an unadvertised server', async () => {
    await expect(
      resolveDeviceGatewayEndpoint({ discover: async () => ({ status: 'absent' }) }),
    ).resolves.toEqual({ ok: false, reason: 'not_configured' });
  });

  it('does not fall back to the default when discovery failed', async () => {
    await expect(
      resolveDeviceGatewayEndpoint({
        discover: async () => ({ reason: 'HTTP 500', status: 'failed' }),
        officialGatewayUrl: OFFICIAL,
      }),
    ).resolves.toEqual({ detail: 'HTTP 500', ok: false, reason: 'discovery_failed' });
  });

  it('does not fall back to the default when the advertised value is invalid', async () => {
    await expect(
      resolveDeviceGatewayEndpoint({
        discover: async () => ({ reason: 'bad', status: 'invalid' }),
        officialGatewayUrl: OFFICIAL,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'invalid_advertised_url' });
  });
});
