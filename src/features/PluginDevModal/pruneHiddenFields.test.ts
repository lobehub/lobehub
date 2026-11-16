import { type LobeToolCustomPlugin } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { pruneHiddenFields } from './pruneHiddenFields';

type Mcp = NonNullable<NonNullable<LobeToolCustomPlugin['customParams']>['mcp']>;

const plugin = (mcp: Mcp): LobeToolCustomPlugin => ({
  customParams: { avatar: 'a.png', description: 'desc', mcp },
  identifier: 'demo',
  type: 'customPlugin',
});

const stale = {
  args: ['-y', 'server'],
  auth: { clientId: 'cid', clientSecret: 'secret', token: 'tok', type: 'none' as const },
  command: 'npx',
  env: { KEY: 'v' },
  headers: { 'X-Key': 'h' },
  url: 'https://old.example.com/mcp',
};

describe('pruneHiddenFields', () => {
  it('keeps the HTTP connection choice and drops it after switching to stdio', () => {
    const http = pruneHiddenFields(plugin({ ...stale, connectVia: 'device', type: 'http' }))
      .customParams!.mcp!;
    expect(http.connectVia).toBe('device');

    const stdio = pruneHiddenFields(plugin({ ...stale, connectVia: 'device', type: 'stdio' }))
      .customParams!.mcp!;
    expect(stdio).not.toHaveProperty('connectVia');
  });

  it('drops http fields after switching to stdio', () => {
    const mcp = pruneHiddenFields(plugin({ ...stale, type: 'stdio' })).customParams!.mcp!;

    expect(mcp).toEqual({
      args: ['-y', 'server'],
      command: 'npx',
      env: { KEY: 'v' },
      type: 'stdio',
    });
  });

  it('drops stdio fields and auth secrets when http auth is none', () => {
    const mcp = pruneHiddenFields(plugin({ ...stale, type: 'http' })).customParams!.mcp!;

    expect(mcp).toEqual({
      auth: { type: 'none' },
      headers: { 'X-Key': 'h' },
      type: 'http',
      url: 'https://old.example.com/mcp',
    });
  });

  it('keeps only the token for bearer auth', () => {
    const mcp = pruneHiddenFields(
      plugin({ ...stale, auth: { ...stale.auth, type: 'bearer' }, type: 'http' }),
    ).customParams!.mcp!;

    expect(mcp.auth).toEqual({ token: 'tok', type: 'bearer' });
  });

  it('keeps only oauth credentials for oauth2 auth', () => {
    const mcp = pruneHiddenFields(
      plugin({
        ...stale,
        auth: { ...stale.auth, accessToken: 'at', type: 'oauth2' },
        type: 'http',
      }),
    ).customParams!.mcp!;

    expect(mcp.auth).toEqual({
      accessToken: 'at',
      clientId: 'cid',
      clientSecret: 'secret',
      type: 'oauth2',
    });
  });

  it('keeps fields outside the conditional branches', () => {
    const result = pruneHiddenFields(plugin({ ...stale, type: 'stdio' }));

    expect(result.identifier).toBe('demo');
    expect(result.customParams).toMatchObject({ avatar: 'a.png', description: 'desc' });
  });

  it('leaves cloud and non-mcp plugins untouched', () => {
    const cloud = plugin({ ...stale, type: 'cloud' });
    const legacy: LobeToolCustomPlugin = { identifier: 'x', type: 'customPlugin' };

    expect(pruneHiddenFields(cloud)).toBe(cloud);
    expect(pruneHiddenFields(legacy)).toBe(legacy);
  });

  it('keeps a device binding only for a server that runs on the device', () => {
    const stdio = pruneHiddenFields(plugin({ ...stale, boundDeviceId: 'nas', type: 'stdio' }))
      .customParams!.mcp!;
    expect(stdio.boundDeviceId).toBe('nas');

    const lan = pruneHiddenFields(
      plugin({ ...stale, boundDeviceId: 'nas', type: 'http', url: 'http://192.168.1.10/mcp' }),
    ).customParams!.mcp!;
    expect(lan.boundDeviceId).toBe('nas');

    const viaDevice = pruneHiddenFields(
      plugin({ ...stale, boundDeviceId: 'nas', connectVia: 'device', type: 'http' }),
    ).customParams!.mcp!;
    expect(viaDevice.boundDeviceId).toBe('nas');

    // Switched to a public server the cloud reaches itself
    const publicHttp = pruneHiddenFields(plugin({ ...stale, boundDeviceId: 'nas', type: 'http' }))
      .customParams!.mcp!;
    expect(publicHttp).not.toHaveProperty('boundDeviceId');
  });
});
