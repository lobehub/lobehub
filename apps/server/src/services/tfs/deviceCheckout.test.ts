import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeTfsDeviceCheckout } from './deviceCheckout';

const mocks = vi.hoisted(() => ({ init: vi.fn(), personal: vi.fn(), execute: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findPersonalByDeviceId = mocks.personal;
  },
}));
vi.mock('@/server/services/sandbox/session', () => ({ resolveSandboxInitialization: mocks.init }));
vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: mocks.execute,
}));

const params = {
  cwd: '/work/project',
  db: {} as never,
  deviceId: 'own-device',
  topicId: 'topic',
  userId: 'caller',
};
const init = {
  sources: [{ url: 'https://dev.example.com/Collection/P/_git/R', ref: 'main' }],
  cloneCredential: {
    tfs: { authType: 'ntlm', username: 'DOMAIN\\caller', secret: 'test-only-secret' },
    urlPrefix: 'https://dev.example.com/Collection/',
  },
};

describe('personal TFS device initialization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.init.mockResolvedValue(init);
    mocks.personal.mockResolvedValue({ deviceId: 'own-device' });
    mocks.execute.mockResolvedValue({
      success: true,
      content: 'ready',
      state: { env: 'never forward' },
    });
  });

  it('initializes the caller personal device and exposes only sanitized command output', async () => {
    const onCredential = vi.fn();
    mocks.execute.mockResolvedValue({
      success: true,
      content: `failure ${init.cloneCredential.tfs.secret}`,
      state: { env: 'private' },
    });
    expect(await initializeTfsDeviceCheckout({ ...params, onCredential })).toBe(
      'TFS checkout: failure [redacted]',
    );
    const args = JSON.parse(mocks.execute.mock.calls[0][2].arguments);
    expect(args.command).not.toContain(init.cloneCredential.tfs.secret);
    expect(args.env.GIT_CONFIG_COUNT).toBeDefined();
    expect(args.cwd).toBe('/work/project');
    expect(onCredential).toHaveBeenCalledWith([
      ['credential.helper', ''],
      [
        `credential.${init.cloneCredential.urlPrefix}.helper`,
        expect.stringContaining(init.cloneCredential.tfs.secret),
      ],
      [`http.${init.cloneCredential.urlPrefix}.followRedirects`, 'false'],
    ]);
  });

  it('does not release Git credentials when checkout fails', async () => {
    const onCredential = vi.fn();
    mocks.execute.mockResolvedValue({ success: false, content: 'failed' });

    await initializeTfsDeviceCheckout({ ...params, onCredential });

    expect(onCredential).not.toHaveBeenCalled();
  });

  it.each([{ deviceWorkspaceId: 'ws' }, { otherOwner: true }])(
    'never sends personal credentials to a shared or other-owned device %#',
    async ({ deviceWorkspaceId, otherOwner }) => {
      if (otherOwner) mocks.personal.mockResolvedValue(undefined);
      expect(await initializeTfsDeviceCheckout({ ...params, deviceWorkspaceId })).toContain(
        'not your personal device',
      );
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it('reports unavailable authorization and does not fall back to ambient device credentials', async () => {
    mocks.init.mockResolvedValue({ ...init, authorizationError: 'unavailable' });
    expect(await initializeTfsDeviceCheckout(params)).toContain('reconnect');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('leaves non-TFS conversations alone', async () => {
    mocks.init.mockResolvedValue(undefined);
    expect(await initializeTfsDeviceCheckout(params)).toBeUndefined();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('does not expose exceptions containing the credential-bearing device request', async () => {
    mocks.execute.mockRejectedValue(new Error(JSON.stringify(init)));
    const report = await initializeTfsDeviceCheckout(params);
    expect(report).toContain('checkout failed');
    expect(report).not.toContain(init.cloneCredential.tfs.secret);
  });
});
