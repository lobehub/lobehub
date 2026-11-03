import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  BrowserLoginDataDomain,
  BrowserLoginDataErrorCode,
  BrowserLoginDataSource,
} from '@lobechat/electron-client-ipc';
import type { Cookie, CookiesSetDetails, Session } from 'electron';

/**
 * Imports login state (cookies) from a local Chromium-family browser into the
 * in-app browser's persistent partition.
 *
 * Cookie values are encrypted at rest (Windows: DPAPI-wrapped AES-GCM key with
 * `v10`, or app-bound `v20`; macOS: Keychain; Linux: keyring or `v10` fallback).
 * Rather than re-implementing each scheme, the cookie database is copied into a
 * throwaway profile and the browser's own executable is started on it without a
 * window, so the browser decrypts its own data and hands it over through CDP.
 *
 * Cookie values only ever travel from that headless process into the Electron
 * session. They are never logged, returned to the renderer or sent anywhere.
 */

const DEFAULT_PROFILE = 'Default';
const DEVTOOLS_PORT_FILE = 'DevToolsActivePort';
const DEVTOOLS_TIMEOUT = 15_000;
const COOKIE_PATHS = ['Network/Cookies', 'Cookies'];
const LOCKED_FILE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
/** Chromium stores expiry as microseconds since 1601-01-01 (UTC). */
const CHROMIUM_NOW_MICROSECONDS_SQL =
  "((CAST(strftime('%s', 'now') AS INTEGER) + 11644473600) * 1000000)";

export interface CdpCookie extends Omit<Cookie, 'domain' | 'expirationDate' | 'sameSite'> {
  domain: string;
  expires?: number;
  partitionKey?: unknown;
  sameSite?: 'Lax' | 'None' | 'Strict';
}

interface CdpResponse {
  error?: { message: string };
  id: number;
  result?: { cookies?: CdpCookie[] };
}

interface LocalState {
  profile?: { last_used?: string };
}

export interface BrowserLocations {
  executables: string[];
  label: string;
  userData: string;
}

interface ResolvedProfile {
  cookiePath: string;
  executable: string;
  label: string;
  localStatePath: string;
  profile: string;
  profilePath: string;
}

export class BrowserLoginDataError extends Error {
  readonly code: BrowserLoginDataErrorCode;

  constructor(code: BrowserLoginDataErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BrowserLoginDataError';
  }
}

export const browserLocations = (
  source: BrowserLoginDataSource,
  os: NodeJS.Platform = platform(),
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): BrowserLocations => {
  const programFiles = env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData/Local');

  if (source === 'edge') {
    switch (os) {
      case 'darwin': {
        return {
          executables: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
          label: 'Edge',
          userData: path.join(home, 'Library/Application Support/Microsoft Edge'),
        };
      }
      case 'win32': {
        return {
          executables: [
            path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
            path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
          ],
          label: 'Edge',
          userData: path.join(localAppData, 'Microsoft/Edge/User Data'),
        };
      }
      default: {
        return {
          executables: [
            '/usr/bin/microsoft-edge',
            '/usr/bin/microsoft-edge-stable',
            '/opt/microsoft/msedge/msedge',
          ],
          label: 'Edge',
          userData: path.join(home, '.config/microsoft-edge'),
        };
      }
    }
  }

  switch (os) {
    case 'darwin': {
      return {
        executables: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
        label: 'Chrome',
        userData: path.join(home, 'Library/Application Support/Google/Chrome'),
      };
    }
    case 'win32': {
      return {
        executables: [
          path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
          path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
          path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
        ],
        label: 'Chrome',
        userData: path.join(localAppData, 'Google/Chrome/User Data'),
      };
    }
    default: {
      return {
        executables: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
        label: 'Chrome',
        userData: path.join(home, '.config/google-chrome'),
      };
    }
  }
};

const canAccess = async (target: string, mode: number) => {
  try {
    await access(target, mode);
    return true;
  } catch {
    return false;
  }
};

/** Strips the leading dot Chromium uses for domain cookies. */
export const normalizeCookieHost = (host: string) => host.replace(/^\./, '').toLowerCase();

const resolveProfile = async ({
  executables,
  label,
  userData,
}: BrowserLocations): Promise<ResolvedProfile> => {
  const localStatePath = path.join(userData, 'Local State');

  let executable: string | undefined;
  for (const candidate of executables) {
    if (await canAccess(candidate, constants.X_OK)) {
      executable = candidate;
      break;
    }
  }

  let localState: LocalState;
  try {
    localState = JSON.parse(await readFile(localStatePath, 'utf8')) as LocalState;
  } catch {
    if (!executable) {
      throw new BrowserLoginDataError('browser_not_installed', `${label} is not installed`);
    }
    throw new BrowserLoginDataError('profile_not_found', `${label} user data was not found`);
  }

  // Without the executable the encrypted cookie values cannot be decrypted.
  if (!executable) {
    throw new BrowserLoginDataError('browser_not_installed', `${label} executable was not found`);
  }

  const profile = localState.profile?.last_used || DEFAULT_PROFILE;
  const profilePath = path.join(userData, profile);

  for (const cookiePath of COOKIE_PATHS) {
    if (await canAccess(path.join(profilePath, cookiePath), constants.R_OK)) {
      return { cookiePath, executable, label, localStatePath, profile, profilePath };
    }
  }

  throw new BrowserLoginDataError(
    'profile_not_found',
    `${label} profile "${profile}" has no cookie database`,
  );
};

/**
 * Chromium holds an exclusive lock on the cookie database while it runs
 * (Windows), so copying fails until the browser has fully exited.
 */
const copyCookieDatabase = async (resolved: ResolvedProfile, target: string) => {
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(resolved.profilePath, resolved.cookiePath), target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && LOCKED_FILE_CODES.has(code)) {
      throw new BrowserLoginDataError(
        'cookie_db_locked',
        `${resolved.label} cookie database is in use (${code})`,
      );
    }
    throw error;
  }
};

/** Reads cookie hosts and counts only — the encrypted values are never selected. */
export const readCookieHosts = (cookieDatabasePath: string): Map<string, number> => {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(cookieDatabasePath, { readOnly: true });
    const columns = new Set(
      (database.prepare('PRAGMA table_info(cookies)').all() as { name: string }[]).map(
        (column) => column.name,
      ),
    );
    // Match what the browser itself loads: expired cookies are dropped on load
    // and partitioned (CHIPS) cookies are skipped by the import.
    const filters = [
      columns.has('expires_utc') &&
        `(expires_utc = 0 OR expires_utc > ${CHROMIUM_NOW_MICROSECONDS_SQL})`,
      columns.has('top_frame_site_key') && "COALESCE(top_frame_site_key, '') = ''",
    ].filter(Boolean);
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = database
      .prepare(`SELECT host_key AS host, COUNT(*) AS count FROM cookies ${where} GROUP BY host_key`)
      .all() as { count: number; host: string }[];

    const hosts = new Map<string, number>();
    for (const row of rows) {
      const host = normalizeCookieHost(String(row.host));
      if (!host) continue;
      hosts.set(host, (hosts.get(host) ?? 0) + Number(row.count));
    }
    return hosts;
  } catch (error) {
    const message = (error as Error).message || '';
    if (/locked|busy/i.test(message)) {
      throw new BrowserLoginDataError('cookie_db_locked', 'Cookie database is locked');
    }
    throw new BrowserLoginDataError('profile_not_found', 'Cookie database could not be read');
  } finally {
    database?.close();
  }
};

const withTemporaryUserData = async <T>(
  source: BrowserLoginDataSource,
  run: (temporaryUserData: string) => Promise<T>,
) => {
  const temporaryUserData = await mkdtemp(path.join(tmpdir(), `lobehub-${source}-import-`));
  try {
    return await run(temporaryUserData);
  } finally {
    // Leftover helper processes can hold files briefly (Windows). A failed
    // cleanup must not turn a finished import into a reported failure.
    await rm(temporaryUserData, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 200,
    }).catch(() => {});
  }
};

export const previewBrowserLoginData = async (
  source: BrowserLoginDataSource,
  locations: BrowserLocations = browserLocations(source),
): Promise<{ domains: BrowserLoginDataDomain[]; profile: string }> => {
  const resolved = await resolveProfile(locations);

  return withTemporaryUserData(source, async (temporaryUserData) => {
    const target = path.join(temporaryUserData, 'Cookies');
    await copyCookieDatabase(resolved, target);
    const domains = [...readCookieHosts(target)]
      .map(([domain, count]) => ({ count, domain }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

    return { domains, profile: resolved.profile };
  });
};

const hasExited = (browserProcess: ReturnType<typeof spawn>) =>
  browserProcess.exitCode !== null || browserProcess.signalCode !== null;

/**
 * Headless mode swaps in a mock keychain (macOS) and the basic password store
 * (Linux), which cannot decrypt cookies sealed with the user's real key. Off
 * Windows, start the real browser without opening a window instead.
 */
export const browserLaunchArgs = (
  temporaryUserData: string,
  profile: string,
  os: NodeJS.Platform = platform(),
) => [
  `--user-data-dir=${temporaryUserData}`,
  `--profile-directory=${profile}`,
  '--remote-debugging-port=0',
  os === 'win32' ? '--headless=new' : '--no-startup-window',
  '--disable-extensions',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  ...(os === 'win32' ? ['about:blank'] : []),
];

const waitForDevTools = async (
  userData: string,
  browserProcess: ReturnType<typeof spawn>,
  label: string,
) => {
  const portFile = path.join(userData, DEVTOOLS_PORT_FILE);
  const deadline = Date.now() + DEVTOOLS_TIMEOUT;
  let startError: Error | undefined;
  browserProcess.once('error', (error) => {
    startError = error;
  });

  while (Date.now() < deadline) {
    if (startError || hasExited(browserProcess)) {
      throw new BrowserLoginDataError('browser_start_failed', `${label} could not be started`);
    }
    try {
      const [port, browserPath] = (await readFile(portFile, 'utf8')).trim().split('\n');
      if (port && browserPath) return `ws://127.0.0.1:${port}${browserPath}`;
    } catch {
      // The browser creates DevToolsActivePort asynchronously after startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new BrowserLoginDataError('browser_start_failed', `Timed out while starting ${label}`);
};

const readCookies = (webSocketUrl: string): Promise<CdpCookie[]> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const fail = (message: string) =>
      reject(new BrowserLoginDataError('browser_start_failed', message));
    const timeout = setTimeout(() => {
      socket.close();
      fail('Timed out while reading login information');
    }, DEVTOOLS_TIMEOUT);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
    });
    socket.addEventListener('message', (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse;
      if (response.id !== 1) return;

      clearTimeout(timeout);
      socket.close();
      if (response.error) fail(response.error.message);
      else resolve(response.result?.cookies ?? []);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      fail('Could not connect to the temporary browser profile');
    });
  });

export const toElectronSameSite = (sameSite?: CdpCookie['sameSite']): Cookie['sameSite'] => {
  switch (sameSite) {
    case 'Lax': {
      return 'lax';
    }
    case 'None': {
      return 'no_restriction';
    }
    case 'Strict': {
      return 'strict';
    }
    default: {
      return 'unspecified';
    }
  }
};

/**
 * CDP marks domain cookies with a leading dot. Host-only cookies (including
 * `__Host-` ones) must be written without `domain`, or Chromium widens or
 * rejects them.
 */
export const toElectronCookie = (cookie: CdpCookie): CookiesSetDetails => {
  const host = normalizeCookieHost(cookie.domain);
  const cookiePath = cookie.path || '/';

  return {
    domain: cookie.domain.startsWith('.') ? cookie.domain : undefined,
    expirationDate: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined,
    httpOnly: cookie.httpOnly,
    name: cookie.name,
    path: cookiePath,
    sameSite: toElectronSameSite(cookie.sameSite),
    secure: cookie.secure,
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookiePath}`,
    value: cookie.value,
  };
};

export interface BrowserLoginDataImportSummary {
  failedDomains: string[];
  importedCount: number;
  importedDomainCount: number;
}

/**
 * Hosts present on disk but missing from the decrypted set could not be
 * decrypted by the browser; hosts with a rejected `cookies.set` failed to write.
 */
export const summarizeImport = ({
  expectedHosts,
  importedHosts,
  importedCount,
  rejectedHosts,
}: {
  expectedHosts: Iterable<string>;
  importedCount: number;
  importedHosts: Set<string>;
  rejectedHosts: Set<string>;
}): BrowserLoginDataImportSummary => {
  const failed = new Set(rejectedHosts);
  for (const host of expectedHosts) {
    if (!importedHosts.has(host)) failed.add(host);
  }

  return {
    failedDomains: [...failed].sort(),
    importedCount,
    importedDomainCount: importedHosts.size,
  };
};

export const importBrowserLoginData = async (
  browserSession: Session,
  { domains, source }: { domains?: string[]; source: BrowserLoginDataSource },
  locations: BrowserLocations = browserLocations(source),
): Promise<BrowserLoginDataImportSummary> => {
  const resolved = await resolveProfile(locations);
  const selectedHosts = domains ? new Set(domains.map(normalizeCookieHost)) : undefined;
  const isSelected = (host: string) => !selectedHosts || selectedHosts.has(host);

  return withTemporaryUserData(source, async (temporaryUserData) => {
    const temporaryProfile = path.join(temporaryUserData, resolved.profile);
    const temporaryCookies = path.join(temporaryProfile, resolved.cookiePath);
    await copyCookieDatabase(resolved, temporaryCookies);
    await Promise.all([
      cp(resolved.localStatePath, path.join(temporaryUserData, 'Local State')),
      cp(
        path.join(resolved.profilePath, 'Preferences'),
        path.join(temporaryProfile, 'Preferences'),
      ).catch(() => {
        // Preferences only carries profile settings; decryption does not depend on it.
      }),
    ]);

    const expectedHosts = [...readCookieHosts(temporaryCookies).keys()].filter(isSelected);
    if (expectedHosts.length === 0) {
      return { failedDomains: [], importedCount: 0, importedDomainCount: 0 };
    }

    const browserProcess = spawn(
      resolved.executable,
      browserLaunchArgs(temporaryUserData, resolved.profile),
      { stdio: 'ignore' },
    );

    try {
      const cookies = (
        await readCookies(await waitForDevTools(temporaryUserData, browserProcess, resolved.label))
      ).filter(
        // Partitioned (CHIPS) cookies would lose their top-level-site scope in
        // cookies.set, so they are left out like in the preview.
        (cookie) => !cookie.partitionKey && isSelected(normalizeCookieHost(cookie.domain)),
      );

      // Every cookie on disk was dropped: the browser could not decrypt them
      // (e.g. the OS key store denied access).
      if (cookies.length === 0) {
        throw new BrowserLoginDataError(
          'decrypt_failed',
          `${resolved.label} could not decrypt ${expectedHosts.length} site(s)`,
        );
      }

      const importedHosts = new Set<string>();
      const rejectedHosts = new Set<string>();
      let importedCount = 0;

      for (const cookie of cookies) {
        const host = normalizeCookieHost(cookie.domain);
        try {
          await browserSession.cookies.set(toElectronCookie(cookie));
          importedHosts.add(host);
          importedCount += 1;
        } catch {
          // Invalid or unsupported cookies should not prevent the rest of the profile importing.
          rejectedHosts.add(host);
        }
      }

      await browserSession.cookies.flushStore();
      return summarizeImport({ expectedHosts, importedCount, importedHosts, rejectedHosts });
    } finally {
      if (!hasExited(browserProcess) && !browserProcess.killed) {
        browserProcess.kill('SIGTERM');
        await Promise.race([
          once(browserProcess, 'exit'),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      }
    }
  });
};
