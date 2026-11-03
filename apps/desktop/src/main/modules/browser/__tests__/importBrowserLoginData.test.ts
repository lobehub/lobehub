import type * as FsPromises from 'node:fs/promises';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserLocations } from '../importBrowserLoginData';
import {
  browserLaunchArgs,
  browserLocations,
  importBrowserLoginData,
  normalizeCookieHost,
  previewBrowserLoginData,
  readCookieHosts,
  summarizeImport,
  toElectronCookie,
} from '../importBrowserLoginData';

const { cpFailure } = vi.hoisted(() => ({ cpFailure: { code: undefined as string | undefined } }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    cp: (async (...args: Parameters<typeof actual.cp>) => {
      if (cpFailure.code) {
        throw Object.assign(new Error('resource busy or locked'), { code: cpFailure.code });
      }
      return actual.cp(...args);
    }) as typeof actual.cp,
  };
});

const SECRET = 'super-secret-session-value';

const createCookieDatabase = (file: string, hosts: string[]) => {
  const database = new DatabaseSync(file);
  database.exec(
    'CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB)',
  );
  const insert = database.prepare(
    'INSERT INTO cookies (host_key, name, value, encrypted_value) VALUES (?, ?, ?, ?)',
  );
  for (const host of hosts) insert.run(host, 'sid', SECRET, Buffer.from(`v10${SECRET}`));
  database.close();
};

describe('importBrowserLoginData', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'browser-login-test-'));
  });

  afterEach(async () => {
    cpFailure.code = undefined;
    await rm(root, { force: true, recursive: true });
  });

  const createProfile = async ({
    executable = true,
    hosts = ['.github.com', 'github.com', '.example.com'],
    profile = 'Profile 1',
  }: {
    executable?: boolean;
    hosts?: string[];
    profile?: string;
  } = {}): Promise<BrowserLocations> => {
    const userData = path.join(root, 'User Data');
    const executablePath = path.join(root, 'msedge');
    await mkdir(path.join(userData, profile, 'Network'), { recursive: true });
    await writeFile(
      path.join(userData, 'Local State'),
      JSON.stringify({ profile: { last_used: profile } }),
    );
    createCookieDatabase(path.join(userData, profile, 'Network/Cookies'), hosts);
    if (executable) {
      await writeFile(executablePath, '#!/bin/sh\n');
      await chmod(executablePath, 0o755);
    }
    return { executables: [executablePath], label: 'Edge', userData };
  };

  describe('browserLocations', () => {
    it('resolves the Windows Edge executable and user data under LOCALAPPDATA', () => {
      const locations = browserLocations(
        'edge',
        'win32',
        {
          'LOCALAPPDATA': 'C:\\Users\\me\\AppData\\Local',
          'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
        },
        'C:\\Users\\me',
      );

      expect(locations.label).toBe('Edge');
      expect(locations.userData).toBe(
        path.join('C:\\Users\\me\\AppData\\Local', 'Microsoft/Edge/User Data'),
      );
      expect(locations.executables[0]).toBe(
        path.join('C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      );
    });

    it('resolves macOS and Linux Edge locations', () => {
      expect(browserLocations('edge', 'darwin', {}, '/Users/me').userData).toBe(
        '/Users/me/Library/Application Support/Microsoft Edge',
      );
      expect(browserLocations('edge', 'linux', {}, '/home/me').userData).toBe(
        '/home/me/.config/microsoft-edge',
      );
    });

    it('keeps Chrome available as a source', () => {
      expect(browserLocations('chrome', 'linux', {}, '/home/me').userData).toBe(
        '/home/me/.config/google-chrome',
      );
    });
  });

  it('normalizes cookie hosts', () => {
    expect(normalizeCookieHost('.GitHub.com')).toBe('github.com');
    expect(normalizeCookieHost('example.com')).toBe('example.com');
  });

  it('skips expired and partitioned cookies like the browser does', () => {
    const file = path.join(root, 'Cookies');
    const database = new DatabaseSync(file);
    database.exec(
      'CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, ' +
        'expires_utc INTEGER, top_frame_site_key TEXT)',
    );
    const insert = database.prepare(
      'INSERT INTO cookies (host_key, name, value, encrypted_value, expires_utc, top_frame_site_key) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
    );
    const toChromium = (ms: number) => (ms * 1000 + 11_644_473_600_000_000).toString();
    insert.run('live.com', 'a', '', Buffer.from('v10'), toChromium(Date.now() + 86_400_000), '');
    insert.run('session.com', 'a', '', Buffer.from('v10'), 0, '');
    insert.run('expired.com', 'a', '', Buffer.from('v10'), toChromium(Date.now() - 86_400_000), '');
    insert.run('chips.com', 'a', '', Buffer.from('v10'), 0, 'https://top.com');
    database.close();

    expect([...readCookieHosts(file).keys()].sort()).toEqual(['live.com', 'session.com']);
  });

  it('avoids headless mode off Windows so the real OS key store is used', () => {
    expect(browserLaunchArgs('/tmp/u', 'Default', 'win32')).toContain('--headless=new');
    for (const os of ['darwin', 'linux'] as const) {
      const args = browserLaunchArgs('/tmp/u', 'Default', os);
      expect(args).toContain('--no-startup-window');
      expect(args.some((arg) => arg.startsWith('--headless'))).toBe(false);
    }
  });

  it('reads host counts without exposing cookie values', async () => {
    const file = path.join(root, 'Cookies');
    createCookieDatabase(file, ['.github.com', 'github.com', 'example.com']);

    const hosts = readCookieHosts(file);

    expect(Object.fromEntries(hosts)).toEqual({ 'example.com': 1, 'github.com': 2 });
    expect(JSON.stringify([...hosts])).not.toContain(SECRET);
  });

  describe('previewBrowserLoginData', () => {
    it('lists hosts of the last used profile, most cookies first', async () => {
      const locations = await createProfile();

      const preview = await previewBrowserLoginData('edge', locations);

      expect(preview).toEqual({
        domains: [
          { count: 2, domain: 'github.com' },
          { count: 1, domain: 'example.com' },
        ],
        profile: 'Profile 1',
      });
      expect(JSON.stringify(preview)).not.toContain(SECRET);
    });

    it('reports a missing browser', async () => {
      await expect(
        previewBrowserLoginData('edge', {
          executables: [path.join(root, 'missing')],
          label: 'Edge',
          userData: path.join(root, 'missing-user-data'),
        }),
      ).rejects.toMatchObject({ code: 'browser_not_installed' });
    });

    it('reports a missing profile when the browser is installed', async () => {
      const locations = await createProfile();
      await rm(path.join(locations.userData, 'Local State'));

      await expect(previewBrowserLoginData('edge', locations)).rejects.toMatchObject({
        code: 'profile_not_found',
      });
    });

    it('reports a locked cookie database', async () => {
      const locations = await createProfile();
      cpFailure.code = 'EBUSY';

      await expect(previewBrowserLoginData('edge', locations)).rejects.toMatchObject({
        code: 'cookie_db_locked',
      });
    });
  });

  it('writes host-only cookies without a domain and keeps domain cookies scoped', () => {
    const base = { httpOnly: true, name: 'sid', path: '/', secure: true, value: 'v' };

    expect(toElectronCookie({ ...base, domain: 'app.example.com' })).toMatchObject({
      domain: undefined,
      url: 'https://app.example.com/',
    });
    expect(toElectronCookie({ ...base, domain: '.example.com', sameSite: 'None' })).toMatchObject({
      domain: '.example.com',
      sameSite: 'no_restriction',
      url: 'https://example.com/',
    });
  });

  it('reports hosts that were not decrypted or were rejected as failed', () => {
    expect(
      summarizeImport({
        expectedHosts: ['a.com', 'b.com', 'c.com'],
        importedCount: 3,
        importedHosts: new Set(['a.com', 'c.com']),
        rejectedHosts: new Set(['c.com']),
      }),
    ).toEqual({ failedDomains: ['b.com', 'c.com'], importedCount: 3, importedDomainCount: 2 });
  });

  it('skips starting the browser when no selected host has cookies', async () => {
    const locations = await createProfile();
    const set = vi.fn();

    const summary = await importBrowserLoginData(
      { cookies: { flushStore: vi.fn(), set } } as never,
      { domains: ['not-there.com'], source: 'edge' },
      locations,
    );

    expect(summary).toEqual({ failedDomains: [], importedCount: 0, importedDomainCount: 0 });
    expect(set).not.toHaveBeenCalled();
  });
});
