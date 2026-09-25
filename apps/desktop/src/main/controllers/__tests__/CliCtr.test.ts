import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import CliCtr from '../CliCtr';
import RemoteServerConfigCtr from '../RemoteServerConfigCtr';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@/modules/cliEmbedding', () => ({
  getCliWrapperDir: () => '/app/userData/bin',
}));

vi.mock('../RemoteServerConfigCtr', () => ({
  default: class RemoteServerConfigCtr {},
}));

const mockRemoteCtr = {
  getAccessToken: vi.fn(),
  getRemoteServerUrl: vi.fn(),
};

const mockApp = {
  getController: vi.fn((c: unknown) => (c === RemoteServerConfigCtr ? mockRemoteCtr : undefined)),
} as unknown as App;

describe('CliCtr.buildCliEnv', () => {
  let ctr: CliCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteCtr.getAccessToken.mockResolvedValue('jwt-token');
    mockRemoteCtr.getRemoteServerUrl.mockResolvedValue('https://app.example.com/');
    ctr = new CliCtr(mockApp);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the caller env and injects the credentials', async () => {
    const env = await ctr.buildCliEnv({ DS_KEY: 'sk-real-secret' });

    expect(env).toMatchObject({
      DS_KEY: 'sk-real-secret',
      LOBEHUB_JWT: 'jwt-token',
      LOBEHUB_SERVER: 'https://app.example.com',
    });
  });

  it('puts the bundled CLI first on PATH so lh resolves to it', async () => {
    vi.stubEnv('PATH', `/usr/local/bin${path.delimiter}/usr/bin`);

    const env = await ctr.buildCliEnv();

    expect(env.PATH).toBe(`/app/userData/bin${path.delimiter}/usr/local/bin${path.delimiter}/usr/bin`);
  });

  it('prepends to a PATH the caller overrode instead of discarding it', async () => {
    const env = await ctr.buildCliEnv({ PATH: '/custom/bin' });

    expect(env.PATH).toBe(`/app/userData/bin${path.delimiter}/custom/bin`);
  });

  it('does not inject credentials when the app is not signed in', async () => {
    mockRemoteCtr.getAccessToken.mockResolvedValue(null);

    const env = await ctr.buildCliEnv({ FOO: 'bar' });

    expect(env.FOO).toBe('bar');
    expect(env).not.toHaveProperty('LOBEHUB_JWT');
    expect(env).not.toHaveProperty('LOBEHUB_SERVER');
  });
});
