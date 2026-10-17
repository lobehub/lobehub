import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

describe.skipIf(process.platform === 'win32')('CliCtr.buildIndirectCliEnv', () => {
  let ctr: CliCtr;
  let binDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteCtr.getAccessToken.mockResolvedValue('jwt-token');
    mockRemoteCtr.getRemoteServerUrl.mockResolvedValue('https://app.example.com/');
    ctr = new CliCtr(mockApp);
    // Stands in for the real CLI further down PATH: prints what it was given.
    binDir = mkdtempSync(path.join(tmpdir(), 'cli-bin-'));
    writeFileSync(
      path.join(binDir, 'lh'),
      '#!/bin/sh\necho "lh $* jwt=$LOBEHUB_JWT server=$LOBEHUB_SERVER"\n',
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    rmSync(binDir, { force: true, recursive: true });
  });

  const sh = (script: string, env: Record<string, string>) =>
    execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { ...env } });

  it('authenticates an lh the command reaches indirectly', async () => {
    const { dispose, env } = await ctr.buildIndirectCliEnv({ PATH: `${binDir}:/usr/bin:/bin` });

    try {
      expect(sh('echo start; lh whoami', env)).toBe(
        'start\nlh whoami jwt=jwt-token server=https://app.example.com\n',
      );
    } finally {
      dispose();
    }
  });

  it('keeps the token out of every other process the command spawns', async () => {
    const { dispose, env } = await ctr.buildIndirectCliEnv({ PATH: `${binDir}:/usr/bin:/bin` });

    try {
      expect(env).not.toHaveProperty('LOBEHUB_JWT');
      // `npm install && lh …`: whatever runs before (or beside) lh sees nothing.
      expect(sh('sh -c \'echo "before=[$LOBEHUB_JWT]"\' && lh whoami', env)).toBe(
        'before=[]\nlh whoami jwt=jwt-token server=https://app.example.com\n',
      );
    } finally {
      dispose();
    }
  });

  it('deletes the shim, and the token in it, on dispose', async () => {
    const { dispose, env } = await ctr.buildIndirectCliEnv({ PATH: `${binDir}:/usr/bin:/bin` });
    const shimDir = env.PATH.split(path.delimiter)[0];
    expect(existsSync(path.join(shimDir, 'lh'))).toBe(true);

    dispose();

    expect(existsSync(shimDir)).toBe(false);
  });

  it('adds no shim when the app is not signed in', async () => {
    mockRemoteCtr.getAccessToken.mockResolvedValue(null);

    const { env } = await ctr.buildIndirectCliEnv({ PATH: '/custom/bin' });

    expect(env.PATH).toBe(`/app/userData/bin${path.delimiter}/custom/bin`);
  });
});
