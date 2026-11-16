import { describe, expect, it } from 'vitest';

import {
  connectorConnectVia,
  connectorDeviceBinding,
  connectorMcpEndpoint,
  isDeviceOnlyMcpEndpoint,
  shouldConnectViaDevice,
} from './mcpEndpoint';

describe('isDeviceOnlyMcpEndpoint', () => {
  it('treats stdio as device-only', () => {
    expect(isDeviceOnlyMcpEndpoint({ type: 'stdio' })).toBe(true);
  });

  it('treats a localhost or private-network HTTP endpoint as device-only', () => {
    expect(isDeviceOnlyMcpEndpoint({ type: 'http', url: 'http://localhost:3000/mcp' })).toBe(true);
    expect(isDeviceOnlyMcpEndpoint({ type: 'http', url: 'http://192.168.1.8/mcp' })).toBe(true);
    expect(isDeviceOnlyMcpEndpoint({ type: null, url: 'http://127.0.0.1:8080' })).toBe(true);
  });

  it('allows a public HTTP endpoint and the cloud transport', () => {
    expect(isDeviceOnlyMcpEndpoint({ type: 'http', url: 'https://mcp.example.com' })).toBe(false);
    expect(isDeviceOnlyMcpEndpoint({ type: 'cloud', url: 'http://localhost:3000' })).toBe(false);
    expect(isDeviceOnlyMcpEndpoint({})).toBe(false);
  });

  it('treats an HTTP endpoint set to connect through the device as device-only', () => {
    expect(
      isDeviceOnlyMcpEndpoint({
        connectVia: 'device',
        type: 'http',
        url: 'https://nas.tail1234.ts.net/mcp',
      }),
    ).toBe(true);
    // The choice is the user's even when the address can't be read
    expect(isDeviceOnlyMcpEndpoint({ connectVia: 'device', type: 'http' })).toBe(true);
    // A market-hosted server has no device side to connect from
    expect(
      isDeviceOnlyMcpEndpoint({ connectVia: 'device', type: 'cloud', url: 'https://x.dev' }),
    ).toBe(false);
  });
});

describe('shouldConnectViaDevice', () => {
  const urls = {
    domain: 'https://mcp.example.com/mcp',
    lan: 'http://192.168.1.8:8080/mcp',
    localhost: 'http://localhost:3000/mcp',
    magicDns: 'http://nas.tail1234.ts.net:8080/mcp',
    mdns: 'http://printer.local/mcp',
    tailscaleIp: 'http://100.101.102.103/mcp',
  };

  describe('with a device gateway', () => {
    const gateway = { deviceGatewayConfigured: true };

    it.each([
      ['domain', false],
      ['lan', true],
      ['localhost', true],
      ['magicDns', false],
      ['mdns', false],
      ['tailscaleIp', false],
    ] as const)('auto: %s → device=%s (decided by the address)', (key, expected) => {
      expect(shouldConnectViaDevice({ type: 'http', url: urls[key] }, gateway)).toBe(expected);
      expect(
        shouldConnectViaDevice({ connectVia: 'auto', type: 'http', url: urls[key] }, gateway),
      ).toBe(expected);
    });

    it.each(Object.keys(urls) as (keyof typeof urls)[])(
      'device: %s always connects through the device',
      (key) => {
        expect(
          shouldConnectViaDevice({ connectVia: 'device', type: 'http', url: urls[key] }, gateway),
        ).toBe(true);
      },
    );

    it('runs stdio on the device and never a cloud server', () => {
      expect(shouldConnectViaDevice({ type: 'stdio' }, gateway)).toBe(true);
      expect(shouldConnectViaDevice({ connectVia: 'device', type: 'stdio' }, gateway)).toBe(true);
      expect(
        shouldConnectViaDevice({ connectVia: 'device', type: 'cloud', url: urls.domain }, gateway),
      ).toBe(false);
    });
  });

  describe('without a device gateway (self-hosted)', () => {
    const noGateway = { deviceGatewayConfigured: false };

    it('keeps every HTTP endpoint in-process, whatever the choice', () => {
      for (const url of Object.values(urls)) {
        expect(shouldConnectViaDevice({ type: 'http', url }, noGateway)).toBe(false);
        expect(shouldConnectViaDevice({ connectVia: 'device', type: 'http', url }, noGateway)).toBe(
          false,
        );
      }
    });

    it('still sends stdio to a device, so the caller fails instead of spawning it', () => {
      expect(shouldConnectViaDevice({ type: 'stdio' }, noGateway)).toBe(true);
    });
  });
});

describe('connectorMcpEndpoint', () => {
  it('reads the connection choice from the connector metadata', () => {
    expect(
      connectorMcpEndpoint({
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.com',
        metadata: { connectVia: 'device' },
      }),
    ).toEqual({ connectVia: 'device', type: 'http', url: 'https://mcp.example.com' });
  });

  it('reads anything but `device` as auto', () => {
    expect(connectorConnectVia(undefined)).toBe('auto');
    expect(connectorConnectVia(null)).toBe('auto');
    expect(connectorConnectVia({})).toBe('auto');
    expect(connectorConnectVia({ connectVia: 'cloud' })).toBe('auto');
    expect(connectorConnectVia({ connectVia: 'device' })).toBe('device');
  });
});

describe('connectorDeviceBinding', () => {
  const stdio = { mcpConnectionType: 'stdio', mcpServerUrl: null };

  it('is the bound device of a personal connector', () => {
    expect(connectorDeviceBinding({ ...stdio, metadata: { boundDeviceId: 'laptop' } })).toEqual({
      deviceId: 'laptop',
    });
  });

  it("names the workspace pool of a workspace connector's device", () => {
    expect(
      connectorDeviceBinding({ ...stdio, metadata: { boundDeviceId: 'nas' }, workspaceId: 'ws1' }),
    ).toEqual({ deviceId: 'nas', workspaceId: 'ws1' });
  });

  it('binds an HTTP server only when it runs on the device', () => {
    const bound = { boundDeviceId: 'nas' };
    expect(
      connectorDeviceBinding({
        mcpConnectionType: 'http',
        mcpServerUrl: 'http://192.168.1.10:8000/mcp',
        metadata: bound,
      }),
    ).toEqual({ deviceId: 'nas' });
    expect(
      connectorDeviceBinding({
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://nas.tail1234.ts.net/mcp',
        metadata: { ...bound, connectVia: 'device' },
      }),
    ).toEqual({ deviceId: 'nas' });
    // A server the cloud reaches itself ignores a binding left on it
    expect(
      connectorDeviceBinding({
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.com',
        metadata: bound,
      }),
    ).toBeUndefined();
  });

  it('is unbound without a usable device id', () => {
    expect(connectorDeviceBinding({ ...stdio, metadata: null })).toBeUndefined();
    expect(connectorDeviceBinding({ ...stdio, metadata: { boundDeviceId: '' } })).toBeUndefined();
    expect(connectorDeviceBinding({ ...stdio, metadata: { boundDeviceId: 1 } })).toBeUndefined();
  });
});
