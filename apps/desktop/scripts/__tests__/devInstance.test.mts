import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  copyLoginItems,
  createDesktopDevInstance,
  describeLoginState,
  getAppDataDirectory,
  getCheckoutLabel,
  getDesktopDevEnvironment,
  probeCdpPages,
  readTokenState,
  saveLoginState,
  seedLoginState,
  waitForDesktopWindow,
} from '../devInstance.mts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'dev-instance-'));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const writeProfile = async (
  directory: string,
  settings: Record<string, unknown>,
  extraItems: string[] = [],
) => {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'lobehub-settings.json'), JSON.stringify(settings));
  for (const item of extraItems) await writeFile(path.join(directory, item), item);
};

const signedIn = { encryptedTokens: { expiresAt: 2_000_000_000_000, refreshToken: 'r' } };

describe('instance environment', () => {
  it('derives the IPC socket name from the CDP port so id schemes cannot collide', () => {
    const instance = createDesktopDevInstance({
      cdpPort: 9317,
      label: 'feature-x',
      rendererPort: 5217,
      userDataDirectory: '/tmp/profile',
    });

    expect(getDesktopDevEnvironment(instance)).toEqual({
      LOBE_DESKTOP_CDP_PORT: '9317',
      LOBE_DESKTOP_INSTANCE_LABEL: 'feature-x',
      LOBE_DESKTOP_USER_DATA_DIR: '/tmp/profile',
      LOBE_DESKTOP_VITE_PORT: '5217',
      LOBE_IPC_ID: 'lobehub-desktop-dev-9317',
    });
  });

  it('asks for the mock keychain only for a profile of its own', () => {
    expect(
      getDesktopDevEnvironment(
        createDesktopDevInstance({
          cdpPort: 9317,
          mockKeychain: true,
          rendererPort: 5217,
          userDataDirectory: '/tmp/profile',
        }),
      ),
    ).toMatchObject({ LOBE_DESKTOP_MOCK_KEYCHAIN: '1' });
    expect(
      getDesktopDevEnvironment(
        createDesktopDevInstance({ cdpPort: 9223, mockKeychain: true, rendererPort: 5174 }),
      ),
    ).not.toHaveProperty('LOBE_DESKTOP_MOCK_KEYCHAIN');
  });

  it('omits the profile and label when the shared default applies', () => {
    expect(
      getDesktopDevEnvironment(createDesktopDevInstance({ cdpPort: 9223, rendererPort: 5174 })),
    ).toEqual({
      LOBE_DESKTOP_CDP_PORT: '9223',
      LOBE_DESKTOP_VITE_PORT: '5174',
      LOBE_IPC_ID: 'lobehub-desktop-dev-9223',
    });
  });

  it('labels a checkout by directory and adds the branch only when the name hides it', () => {
    expect(getCheckoutLabel({ branch: 'feat/desktop-label', root: '/w/feat-desktop-label' })).toBe(
      'feat-desktop-label',
    );
    expect(getCheckoutLabel({ branch: 'main', root: '/w/lobehub' })).toBe('lobehub · main');
    expect(getCheckoutLabel({ branch: '', root: '/w/lobehub' })).toBe('lobehub');
  });

  it('resolves Electron appData per platform', () => {
    expect(getAppDataDirectory('darwin', {}, '/Users/u')).toBe(
      '/Users/u/Library/Application Support',
    );
    expect(getAppDataDirectory('linux', { XDG_CONFIG_HOME: '/cfg' }, '/home/u')).toBe('/cfg');
    expect(getAppDataDirectory('linux', {}, '/home/u')).toBe('/home/u/.config');
    expect(getAppDataDirectory('win32', { APPDATA: 'C:\\A' }, 'C:\\U')).toBe('C:\\A');
  });
});

describe('renderer probes', () => {
  const fetchTargets = (targets: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(targets))) as unknown as typeof fetch;

  it('is true when any page target evaluates to true', async () => {
    const evaluate = vi.fn(async (url: string) => url === 'ws://page-2');

    await expect(
      probeCdpPages(
        9300,
        'expr',
        fetchTargets([
          { type: 'page', webSocketDebuggerUrl: 'ws://page-1' },
          { type: 'service_worker', webSocketDebuggerUrl: 'ws://worker' },
          { type: 'page', webSocketDebuggerUrl: 'ws://page-2' },
        ]),
        evaluate,
      ),
    ).resolves.toBe(true);
    expect(evaluate).not.toHaveBeenCalledWith('ws://worker', 'expr');
  });

  it('is false when CDP is unreachable or every evaluation fails', async () => {
    const unreachable = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(probeCdpPages(9300, 'expr', unreachable)).resolves.toBe(false);

    await expect(
      probeCdpPages(
        9300,
        'expr',
        fetchTargets([{ type: 'page', webSocketDebuggerUrl: 'ws://page' }]),
        vi.fn(async () => {
          throw new Error('closed');
        }),
      ),
    ).resolves.toBe(false);
  });

  it('reports a timeout instead of throwing so callers decide whether it is fatal', async () => {
    let clock = 0;
    const probe = vi.fn(async () => false);
    const wait = vi.fn(async (durationMs: number) => {
      clock += durationMs;
    });

    await expect(
      waitForDesktopWindow({ cdpPort: 9300, now: () => clock, probe, timeoutMs: 3000, wait }),
    ).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(clock).toBe(3000);
  });

  /** Regression: a fixed attempt count let 2s probes stretch a 60s wait to about 180s. */
  it('stops at the deadline even when each probe is slow', async () => {
    let clock = 0;
    const probe = vi.fn(async () => {
      clock += 2000;
      return false;
    });
    const wait = vi.fn(async (durationMs: number) => {
      clock += durationMs;
    });

    await expect(
      waitForDesktopWindow({ cdpPort: 9300, now: () => clock, probe, timeoutMs: 3000, wait }),
    ).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(clock).toBeLessThanOrEqual(5000);
  });

  it('stops waiting when the process tree exits', async () => {
    await expect(
      waitForDesktopWindow({
        assertRunning: () => {
          throw new Error('exited');
        },
        cdpPort: 9300,
        probe: async () => true,
        timeoutMs: 3000,
      }),
    ).rejects.toThrow('exited');
  });
});

describe('login state', () => {
  it('reads expiry in seconds or milliseconds and treats the refresh token as the signal', async () => {
    const profile = path.join(root, 'profile');
    await writeProfile(profile, { encryptedTokens: { expiresAt: 1000, refreshToken: 'r' } });
    await expect(readTokenState(profile, 0)).resolves.toEqual({
      accessTokenExpiresInMs: 1_000_000,
      hasRefreshToken: true,
    });

    await writeProfile(profile, { encryptedTokens: { expiresAt: 1_700_000_000_000 } });
    await expect(readTokenState(profile, 1_700_000_000_000)).resolves.toEqual({
      accessTokenExpiresInMs: 0,
      hasRefreshToken: false,
    });

    await expect(readTokenState(path.join(root, 'absent'))).resolves.toEqual({
      hasRefreshToken: false,
    });
  });

  it('copies only login items into a private directory and drops the gateway connection id', async () => {
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    await writeProfile(source, { ...signedIn, gatewayDeviceId: 'shared', locale: 'en' }, [
      'Cookies',
      'Cache',
    ]);

    await copyLoginItems(source, target);

    expect((await stat(target)).mode & 0o777).toBe(0o700);
    await expect(stat(path.join(target, 'Cookies'))).resolves.toBeTruthy();
    await expect(stat(path.join(target, 'Cache'))).rejects.toThrow();
    const settings = JSON.parse(await readFile(path.join(target, 'lobehub-settings.json'), 'utf8'));
    expect(settings).toEqual({ ...signedIn, locale: 'en' });
  });

  it('seeds from the first available source', async () => {
    const snapshot = path.join(root, 'snapshot');
    const golden = path.join(root, 'golden');
    await writeProfile(snapshot, signedIn);
    await writeProfile(golden, {});

    const result = await seedLoginState(path.join(root, 'target'), [
      { directory: path.join(root, 'missing'), label: 'missing' },
      { directory: snapshot, label: 'snapshot' },
      { directory: golden, label: 'golden' },
    ]);

    expect(result).toMatchObject({
      canReauth: true,
      source: { label: 'snapshot' },
      status: 'seeded',
    });
    await expect(stat(snapshot)).resolves.toBeTruthy();
  });

  it('leaves an existing profile alone and creates an empty one when nothing can seed it', async () => {
    const existing = path.join(root, 'existing');
    await writeProfile(existing, { locale: 'en' });
    const snapshot = path.join(root, 'snapshot');
    await writeProfile(snapshot, signedIn);

    await expect(
      seedLoginState(existing, [{ directory: snapshot, label: 'snapshot' }]),
    ).resolves.toEqual({ status: 'existing' });
    await expect(stat(snapshot)).resolves.toBeTruthy();

    const fresh = path.join(root, 'fresh');
    await expect(seedLoginState(fresh, [])).resolves.toEqual({ status: 'none' });
    expect((await stat(fresh)).mode & 0o777).toBe(0o700);
  });

  it('keeps the previous snapshot when the source is signed out', async () => {
    const snapshot = path.join(root, 'snapshot');
    await writeProfile(snapshot, signedIn);
    const source = path.join(root, 'source');
    await writeProfile(source, { locale: 'fr' });

    await expect(saveLoginState(source, { snapshotDirectory: snapshot })).resolves.toBe(
      'signed-out',
    );
    expect(
      JSON.parse(await readFile(path.join(snapshot, 'lobehub-settings.json'), 'utf8')),
    ).toEqual(signedIn);
    await expect(
      saveLoginState(path.join(root, 'absent'), { snapshotDirectory: snapshot }),
    ).resolves.toBe('missing');
  });

  it('replaces the snapshot from a signed-in source, including a cookie-only session', async () => {
    const snapshot = path.join(root, 'state', 'snapshot');
    const source = path.join(root, 'source');
    await writeProfile(source, signedIn, ['Cookies']);

    await expect(saveLoginState(source, { snapshotDirectory: snapshot })).resolves.toBe('saved');
    await expect(stat(path.join(snapshot, 'Cookies'))).resolves.toBeTruthy();

    await writeProfile(source, { locale: 'de' });
    await expect(
      saveLoginState(source, { signedIn: true, snapshotDirectory: snapshot }),
    ).resolves.toBe('saved-cookie-only');
  });

  /** Regression: saving chmod-ed the parent to 0700, failing (EPERM) under a shared /tmp. */
  it('keeps the permissions of an existing snapshot parent', async () => {
    const parent = path.join(root, 'shared');
    await mkdir(parent, { mode: 0o755 });
    const snapshot = path.join(parent, 'snapshot');
    const source = path.join(root, 'source');
    await writeProfile(source, signedIn);

    await expect(saveLoginState(source, { snapshotDirectory: snapshot })).resolves.toBe('saved');
    expect((await stat(parent)).mode & 0o777).toBe(0o755);
    expect((await stat(snapshot)).mode & 0o777).toBe(0o700);
  });

  it('describes whether a profile can still sign the next instance in', async () => {
    const profile = path.join(root, 'profile');
    await expect(describeLoginState('snapshot', profile)).resolves.toContain('(absent)');

    await writeProfile(profile, { encryptedTokens: { expiresAt: 7200, refreshToken: 'r' } });
    await expect(describeLoginState('snapshot', profile, 0)).resolves.toContain(
      'refresh token PRESENT — access token fresh for 2h',
    );

    await writeProfile(profile, {});
    await expect(describeLoginState('snapshot', profile)).resolves.toContain('refresh token GONE');
  });
});
