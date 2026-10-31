import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import CliCtr from '../CliCtr';
import RemoteServerConfigCtr from '../RemoteServerConfigCtr';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) =>
    callback(null, { stderr: '', stdout: 'ok' }),
  ),
}));
vi.mock('node:child_process', () => ({ exec: execMock }));

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

    expect(env.PATH).toBe(
      `/app/userData/bin${path.delimiter}/usr/local/bin${path.delimiter}/usr/bin`,
    );
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

describe('CliCtr.runCliCommand', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not let an inherited agent-run JWT file outrank the app token', async () => {
    // Desktop launched from a Codex shell inherits LOBEHUB_JWT_FILE; the CLI prefers the
    // file, so it must not survive the merge with process.env.
    vi.stubEnv('LOBEHUB_JWT_FILE', '/tmp/ancestor/jwt');
    mockRemoteCtr.getAccessToken.mockResolvedValue('jwt-token');
    mockRemoteCtr.getRemoteServerUrl.mockResolvedValue('https://app.example.com/');

    await new CliCtr(mockApp).runCliCommand('whoami');

    const { env } = execMock.mock.calls[0][1] as { env: NodeJS.ProcessEnv };
    expect(env.LOBEHUB_JWT).toBe('jwt-token');
    expect(env.LOBEHUB_JWT_FILE).toBe('');
  });
});
