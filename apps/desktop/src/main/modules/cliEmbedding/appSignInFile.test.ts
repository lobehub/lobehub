import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  prepareAppSignInEnv,
  refreshAppSignIn,
  resetAppSignInForTest,
  withdrawAppSignIn,
} from './appSignInFile';

const signedIn = (
  accessToken: string | null,
  serverUrl: string | null = 'https://app.lobehub.com/',
) => ({
  getAccessToken: async () => accessToken,
  getServerUrl: async () => serverUrl,
});

describe('app sign-in file', () => {
  let appStoragePath: string;

  beforeEach(async () => {
    appStoragePath = await mkdtemp(path.join(os.tmpdir(), 'lobehub-sign-in-'));
  });

  afterEach(async () => {
    resetAppSignInForTest();
    await rm(appStoragePath, { force: true, recursive: true });
  });

  it('writes the token to a private file and returns only its path', async () => {
    const env = await prepareAppSignInEnv({ appStoragePath, auth: signedIn('app-token') });

    const filePath = path.join(appStoragePath, 'cli-auth', 'jwt');
    expect(env).toEqual({ LOBEHUB_JWT_FILE: filePath, LOBEHUB_SERVER: 'https://app.lobehub.com' });
    expect(await readFile(filePath, 'utf8')).toBe('app-token');
    if (process.platform !== 'win32') {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    }
  });

  it.each([
    ['no token', signedIn(null)],
    ['no server', signedIn('app-token', null)],
  ])('hands nothing over when the app has %s', async (_, auth) => {
    await expect(prepareAppSignInEnv({ appStoragePath, auth })).resolves.toBeUndefined();
  });

  /** A run outlives the access token, so `lh` has to see each renewal. */
  it('follows refreshes and is removed on sign-out until the next sign-in', async () => {
    await prepareAppSignInEnv({ appStoragePath, auth: signedIn('first') });
    const filePath = path.join(appStoragePath, 'cli-auth', 'jwt');

    await refreshAppSignIn('renewed');
    expect(await readFile(filePath, 'utf8')).toBe('renewed');

    await withdrawAppSignIn();
    await expect(stat(filePath)).rejects.toThrow();

    await refreshAppSignIn('signed-in-again');
    expect(await readFile(filePath, 'utf8')).toBe('signed-in-again');
  });

  it('writes nothing on refresh before any run asked for the file', async () => {
    await refreshAppSignIn('token');

    await expect(stat(path.join(appStoragePath, 'cli-auth', 'jwt'))).rejects.toThrow();
  });

  /** Local sessions can start together; one writer must not eat the others' temp file. */
  it('lets concurrent first runs publish without losing the sign-in', async () => {
    const envs = await Promise.all(
      [1, 2, 3].map((i) => prepareAppSignInEnv({ appStoragePath, auth: signedIn(`token-${i}`) })),
    );

    expect(envs.every(Boolean)).toBe(true);
    const filePath = path.join(appStoragePath, 'cli-auth', 'jwt');
    expect(['token-1', 'token-2', 'token-3']).toContain(await readFile(filePath, 'utf8'));
  });

  /** Sign-out must win over a renewal that was already on its way. */
  it('does not leave the credential behind when sign-out overlaps a refresh', async () => {
    await prepareAppSignInEnv({ appStoragePath, auth: signedIn('first') });
    const filePath = path.join(appStoragePath, 'cli-auth', 'jwt');

    await Promise.all([refreshAppSignIn('renewed'), withdrawAppSignIn()]);

    await expect(stat(filePath)).rejects.toThrow();
  });
});
