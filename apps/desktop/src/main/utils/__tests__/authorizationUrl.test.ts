import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_URL_FILE_ENV, openAuthorizationUrl } from '../authorizationUrl';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'auth-url-'));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('openAuthorizationUrl', () => {
  it('writes the URL to the launcher file in dev instead of opening a browser', async () => {
    const file = path.join(root, 'auth-url');
    const openExternal = vi.fn(async () => {});

    await expect(
      openAuthorizationUrl('https://x/oidc/auth?state=s', {
        env: { [AUTH_URL_FILE_ENV]: file },
        isDev: true,
        openExternal,
      }),
    ).resolves.toBe('file');

    expect(openExternal).not.toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe('https://x/oidc/auth?state=s');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    /** Renamed into place, so a polling launcher never sees a partial URL. */
    expect(await readdir(root)).toEqual(['auth-url']);
  });

  it('opens the browser when no launcher asked for the URL', async () => {
    const openExternal = vi.fn(async () => {});

    await expect(
      openAuthorizationUrl('https://x', { env: {}, isDev: true, openExternal }),
    ).resolves.toBe('browser');
    expect(openExternal).toHaveBeenCalledWith('https://x');
  });

  it('ignores the variable in a packaged build', async () => {
    const openExternal = vi.fn(async () => {});
    const write = vi.fn();

    await expect(
      openAuthorizationUrl('https://x', {
        env: { [AUTH_URL_FILE_ENV]: path.join(root, 'auth-url') },
        isDev: false,
        openExternal,
        write,
      }),
    ).resolves.toBe('browser');
    expect(write).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://x');
  });
});
