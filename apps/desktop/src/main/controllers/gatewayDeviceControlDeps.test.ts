import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { executeDeviceRpc } from '@lobechat/device-control';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import { createDesktopDeviceControlDeps } from './gatewayDeviceControlDeps';

const { home } = vi.hoisted(() => ({ home: { dir: '' } }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'home' ? home.dir : `/mock/${name}`)),
    getVersion: vi.fn(() => '1.0.0'),
  },
}));
vi.mock('@/modules/terminal/remote', () => ({ getRemoteTerminalDeps: () => ({}) }));
vi.mock('@/modules/updater/configs', () => ({ updaterConfig: { enableAppUpdate: false } }));
vi.mock('@/modules/updater/remoteUpdate', () => ({ createRemoteAppUpdateDeps: () => ({}) }));
vi.mock('@/services/gatewayConnectionSrv', () => ({ default: class {} }));
vi.mock('./HeterogeneousAgentCtr', () => ({ default: class {} }));
vi.mock('./LocalFileCtr', () => ({ default: class {} }));
vi.mock('./McpCtr', () => ({ default: class {} }));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const TOKEN = 'sk-ant-oat01-installed-token';

const fakeApp = {
  getController: () => ({ getSkillDirectoryDeps: () => ({}) }),
  getService: () => ({}),
} as unknown as App;

const credentialDir = () => path.join(home.dir, '.lobehub', 'agent-credentials', 'claude-code');

describe('desktop agent credential RPC handlers', () => {
  beforeEach(async () => {
    home.dir = await mkdtemp(path.join(os.tmpdir(), 'lh-desktop-cred-'));
  });

  afterEach(async () => {
    await rm(home.dir, { force: true, recursive: true });
  });

  it('installs into the store shared with lh connect, under the Electron home', async () => {
    const deps = createDesktopDeviceControlDeps(fakeApp);

    const result = await executeDeviceRpc(
      'installAgentCredential',
      {
        provider: 'claude-code',
        secret: { expiresAt: '2099-01-01T00:00:00Z', token: TOKEN, type: 'claude-oauth-token' },
      },
      deps,
    );

    expect(result).toEqual({ installed: true, provider: 'claude-code' });
    const stored = JSON.parse(
      await readFile(path.join(credentialDir(), 'credential.json'), 'utf8'),
    );
    expect(stored.token).toBe(TOKEN);
    if (process.platform !== 'win32') {
      expect((await stat(path.join(credentialDir(), 'credential.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('reports a missing credential without calling the provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const deps = createDesktopDeviceControlDeps(fakeApp);

    const result = await executeDeviceRpc('checkAgentCredential', { provider: 'codex' }, deps);

    expect(result).toMatchObject({ installed: false, ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('removes the secret and reports nothing left on a second call', async () => {
    const deps = createDesktopDeviceControlDeps(fakeApp);
    await executeDeviceRpc(
      'installAgentCredential',
      {
        provider: 'claude-code',
        secret: { expiresAt: '2099-01-01T00:00:00Z', token: TOKEN, type: 'claude-oauth-token' },
      },
      deps,
    );

    expect(
      await executeDeviceRpc('removeAgentCredential', { provider: 'claude-code' }, deps),
    ).toEqual({ removed: true });
    expect(
      await executeDeviceRpc('removeAgentCredential', { provider: 'claude-code' }, deps),
    ).toEqual({ removed: false });
  });

  it('refuses invalid params without echoing the secret', async () => {
    const deps = createDesktopDeviceControlDeps(fakeApp);

    const error = await executeDeviceRpc(
      'installAgentCredential',
      { provider: 'codex', secret: { token: TOKEN, type: 'claude-oauth-token' } },
      deps,
    ).catch((e: Error) => e);

    expect((error as Error).message).toContain('Agent credential error');
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
