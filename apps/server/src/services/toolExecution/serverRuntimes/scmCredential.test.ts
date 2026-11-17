// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveContextScmCredential } from './scmCredential';

const mocks = vi.hoisted(() => ({ readSystemInfo: vi.fn(), resolve: vi.fn() }));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { readDeviceSystemInfo: mocks.readSystemInfo },
}));
vi.mock('@/server/services/scm/requester/toolCallCredential', () => ({
  resolveToolCallScmCredential: mocks.resolve,
}));

const context = (deviceId: string) =>
  ({ activeDeviceId: deviceId, serverDB: {}, toolManifestMap: {}, userId: 'user-1' }) as any;
const scopes = { contentWorkspaceId: async () => 'ws-1', deviceWorkspaceId: async () => 'ws-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockImplementation(async ({ readSystemInfo }) => {
    await readSystemInfo(['cli']);
    return { kind: 'off' };
  });
});

describe('resolveContextScmCredential', () => {
  it('asks the device what it supports once, not on every command', async () => {
    mocks.readSystemInfo.mockResolvedValue({ ok: true, systemInfo: { supportedTools: [] } });

    await resolveContextScmCredential(context('device-cache-1'), scopes);
    await resolveContextScmCredential(context('device-cache-1'), scopes);

    expect(mocks.readSystemInfo).toHaveBeenCalledTimes(1);
  });

  it('asks again after a device did not answer', async () => {
    mocks.readSystemInfo.mockResolvedValue({ ok: false, reason: 'offline' });

    await resolveContextScmCredential(context('device-cache-2'), scopes);
    await resolveContextScmCredential(context('device-cache-2'), scopes);

    expect(mocks.readSystemInfo).toHaveBeenCalledTimes(2);
  });
});
