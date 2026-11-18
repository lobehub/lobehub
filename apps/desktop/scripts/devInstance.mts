/**
 * One isolated Electron dev instance of `apps/desktop`: its ports, profile, IPC
 * socket and window label, the check that its renderer has rendered, and the
 * login state it can inherit or hand back.
 *
 * Every launcher that runs `pnpm run dev` in this package for more than one
 * checkout at a time (`.agents/acceptance/scripts/electron-dev.sh`, and
 * downstream runtimes that import this file) shares these rules, so a fix here
 * reaches all of them. Only `node:` built-ins are imported and the TypeScript is
 * erasable, so `node scripts/devInstanceCli.mts` runs it without a build step.
 */
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// ─── Instance identity ───────────────────────────────────────────────

export interface DesktopDevInstance {
  /** Chrome DevTools Protocol port (`--remote-debugging-port`). */
  cdpPort: number;
  /**
   * Names the Electron IPC socket (`${ipcId}-electron-ipc.sock` in the temp dir).
   * Without it every dev instance binds the package name and the latest launch
   * takes over the socket.
   */
  ipcId: string;
  /** Shown on every window so a screenshot or a glance tells the checkout apart. */
  label?: string;
  /**
   * Encrypt the profile's tokens and cookies with Chromium's fixed mock key
   * instead of the macOS keychain (`src/main/pre-app-init.ts`). Only for
   * profiles holding test accounts: the key is public, so a production login
   * must stay behind the keychain.
   */
  mockKeychain?: boolean;
  /** Renderer Vite dev server port (`strictPort`, so it must be free). */
  rendererPort: number;
  /**
   * Profile directory. Electron's single-instance lock is keyed by it, so two
   * instances can only run together with distinct directories. Absent means the
   * shared default dev profile.
   */
  userDataDirectory?: string;
}

/**
 * The CDP port already has to be unique per running instance, so deriving the
 * socket name from it keeps launchers with different id schemes (a manual pool
 * id, a checkout slot) from colliding on `lobehub-desktop-dev-<n>`. The name
 * stays short enough for the 104-byte Unix socket path limit.
 */
export const getDesktopDevIpcId = (cdpPort: number) => `lobehub-desktop-dev-${cdpPort}`;

export const createDesktopDevInstance = ({
  cdpPort,
  label,
  mockKeychain,
  rendererPort,
  userDataDirectory,
}: Omit<DesktopDevInstance, 'ipcId'>): DesktopDevInstance => ({
  cdpPort,
  ipcId: getDesktopDevIpcId(cdpPort),
  rendererPort,
  ...(label ? { label } : undefined),
  ...(mockKeychain && userDataDirectory ? { mockKeychain } : undefined),
  ...(userDataDirectory ? { userDataDirectory } : undefined),
});

/** Variables `scripts/dev.mjs` and the main process read to isolate one instance. */
export const getDesktopDevEnvironment = (instance: DesktopDevInstance): Record<string, string> => ({
  LOBE_DESKTOP_CDP_PORT: String(instance.cdpPort),
  LOBE_DESKTOP_VITE_PORT: String(instance.rendererPort),
  LOBE_IPC_ID: instance.ipcId,
  ...(instance.label ? { LOBE_DESKTOP_INSTANCE_LABEL: instance.label } : undefined),
  ...(instance.mockKeychain ? { LOBE_DESKTOP_MOCK_KEYCHAIN: '1' } : undefined),
  ...(instance.userDataDirectory
    ? { LOBE_DESKTOP_USER_DATA_DIR: instance.userDataDirectory }
    : undefined),
});

const execFileAsync = promisify(execFile);

const git = async (checkout: string, args: string[]) => {
  try {
    const { stdout } = await execFileAsync('git', ['-C', checkout, ...args], { encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
};

/**
 * The checkout a developer recognizes: when this repository is a submodule, its
 * own directory name is the same in every superproject worktree, so the
 * superproject's working tree names it instead.
 */
export const readCheckout = async (directory: string) => {
  const superproject = await git(directory, ['rev-parse', '--show-superproject-working-tree']);
  const root =
    superproject || (await git(directory, ['rev-parse', '--show-toplevel'])) || directory;
  return { branch: await git(root, ['branch', '--show-current']), root };
};

/**
 * Names a checkout for the window label: the directory, plus the branch when the
 * directory name does not already spell it (worktree directories usually do).
 */
export const getCheckoutLabel = ({ branch, root }: { branch: string; root: string }) => {
  const name = path.basename(path.resolve(root));
  if (!branch || branch.replaceAll('/', '-') === name) return name;
  return `${name} · ${branch}`;
};

export const readCheckoutLabel = async (directory: string) =>
  getCheckoutLabel(await readCheckout(directory));

/** The profile holds session cookies and tokens, so only the owner may read it. */
export const ensurePrivateDirectory = async (directory: string) => {
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
};

/** Electron's `app.getPath('appData')` for the current platform. */
export const getAppDataDirectory = (
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
) => {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (platform === 'win32') return environment.APPDATA || path.join(home, 'AppData', 'Roaming');
  return environment.XDG_CONFIG_HOME || path.join(home, '.config');
};

/** The profile a dev instance uses without `LOBE_DESKTOP_USER_DATA_DIR` (`src/main/pre-app-init.ts`). */
export const getDefaultDevProfileDirectory = () =>
  path.join(getAppDataDirectory(), 'lobehub-desktop-dev');

/** Survives `/tmp` cleanup and worktree removal; one per machine user. */
export const getDefaultLoginSnapshotDirectory = () =>
  path.join(os.homedir(), '.lobehub', 'agent-testing', 'electron-login');

// ─── Renderer readiness ──────────────────────────────────────────────

const CDP_PROBE_TIMEOUT_MS = 2000;
const RENDERER_RETRY_MS = 1000;

export const getCdpUrl = (cdpPort: number) => `http://127.0.0.1:${cdpPort}`;

interface CdpTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

/**
 * The renderer counts as usable once `#root` (`index.html`) shows text and no
 * loader covers the window. Route boundaries first paint `BrandTextLoading`, a
 * full-window `role="status"` loader whose dev build has its own text, so text
 * alone is not enough; a loader inside already painted chrome (`ContentLoading`
 * in a panel) does not block.
 */
export const RENDERED_EXPRESSION = `(() => {
  if (document.readyState !== 'complete') return false;
  const root = document.getElementById('root');
  if (!root || root.innerText.trim().length === 0) return false;
  const loaders = document.querySelectorAll('[role="status"][aria-label="Loading"]');
  return [...loaders].every((loader) => {
    const box = (loader.parentElement ?? loader).getBoundingClientRect();
    return box.height < window.innerHeight * 0.9;
  });
})()`;

/** `window.__LOBE_STORES` is the dev-only store handle the renderer exposes. */
export const SIGNED_IN_EXPRESSION = `(() => {
  try {
    const user = window.__LOBE_STORES?.user?.();
    return Boolean(user?.user?.id);
  } catch {
    return false;
  }
})()`;

/** Evaluates one expression in a CDP page target and returns its value. */
export const evaluateCdpTarget = (
  webSocketUrl: string,
  expression: string,
  timeoutMs = CDP_PROBE_TIMEOUT_MS,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP evaluation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const settle = (callback: () => void) => {
      clearTimeout(timer);
      socket.close();
      callback();
    };

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: { result?: { value?: unknown } };
      };
      if (message.id === 1) settle(() => resolve(message.result?.result?.value));
    });
    socket.addEventListener('error', () =>
      settle(() => reject(new Error('CDP WebSocket connection failed'))),
    );
  });

/** True when any page target of the instance evaluates `expression` to `true`. */
export const probeCdpPages = async (
  cdpPort: number,
  expression: string,
  fetchImplementation: typeof fetch = fetch,
  evaluate: typeof evaluateCdpTarget = evaluateCdpTarget,
): Promise<boolean> => {
  try {
    const response = await fetchImplementation(`${getCdpUrl(cdpPort)}/json/list`, {
      signal: AbortSignal.timeout(CDP_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    const targets = (await response.json()) as CdpTarget[];
    if (!Array.isArray(targets)) return false;

    const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    const results = await Promise.all(
      pages.map((page) =>
        evaluate(page.webSocketDebuggerUrl!, expression).then(
          (value) => value === true,
          () => false,
        ),
      ),
    );
    return results.includes(true);
  } catch {
    return false;
  }
};

/**
 * True once a page has rendered its UI, the first point an agent can screenshot
 * or drive it. A reachable CDP port does not prove that: the window may still be
 * on its loading screen, or Electron may be about to quit on the single-instance
 * lock.
 */
export const probeDesktopWindow = (
  cdpPort: number,
  fetchImplementation?: typeof fetch,
  evaluate?: typeof evaluateCdpTarget,
) => probeCdpPages(cdpPort, RENDERED_EXPRESSION, fetchImplementation, evaluate);

/**
 * Asks the running renderer whether a user is signed in. The on-disk refresh
 * token is not the only session the app can hold, so this sees what
 * `readTokenState` cannot.
 */
export const probeDesktopSignedIn = (
  cdpPort: number,
  fetchImplementation?: typeof fetch,
  evaluate?: typeof evaluateCdpTarget,
) => probeCdpPages(cdpPort, SIGNED_IN_EXPRESSION, fetchImplementation, evaluate);

export interface WaitForDesktopWindowOptions {
  /** Throws when the Electron process tree has already exited. */
  assertRunning?: () => void;
  cdpPort: number;
  /** Clock for the deadline; defaults to `Date.now`. */
  now?: () => number;
  probe?: (cdpPort: number) => Promise<boolean>;
  signal?: AbortSignal;
  timeoutMs: number;
  wait?: (durationMs: number) => Promise<void>;
}

/** Resolves `true` once the window renders, `false` when `timeoutMs` runs out. */
export const waitForDesktopWindow = async ({
  assertRunning,
  cdpPort,
  probe = probeDesktopWindow,
  signal,
  timeoutMs,
  now = Date.now,
  wait = (durationMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    }),
}: WaitForDesktopWindowOptions) => {
  // A deadline, not an attempt count: an unresponsive renderer makes each probe
  // take seconds, so counting attempts would stretch the wait several times over.
  const deadline = now() + timeoutMs;

  for (;;) {
    signal?.throwIfAborted();
    assertRunning?.();
    if (await probe(cdpPort)) return true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await wait(Math.min(RENDERER_RETRY_MS, remaining));
  }
};

// ─── Login state ─────────────────────────────────────────────────────

/**
 * The login-bearing subset of a profile, skipping the multi-GB caches. The OAuth
 * tokens live in `lobehub-settings.json` → `encryptedTokens`, encrypted with an
 * OS keychain key derived from the app name, which `pre-app-init.ts` keeps
 * constant so a copy still decrypts.
 */
export const LOGIN_ITEMS = [
  'lobehub-settings.json',
  'Local State',
  'Preferences',
  'Cookies',
  'Cookies-journal',
  'Local Storage',
  'IndexedDB',
  'Session Storage',
  'Network Persistent State',
  'lobehub-storage',
];

const SETTINGS_FILE = 'lobehub-settings.json';

/**
 * Per-install values that must not follow a login into another profile.
 * `gatewayDeviceId` is the device gateway connection id: two instances sharing
 * it replace each other's socket on every reconnect.
 */
const INSTALL_SCOPED_SETTINGS = ['gatewayDeviceId'];

const exists = async (target: string) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const readSettings = async (profile: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(path.join(profile, SETTINGS_FILE), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export interface TokenState {
  /** Milliseconds until the ACCESS token expires; negative when already expired. */
  accessTokenExpiresInMs?: number;
  /**
   * The app deletes `encryptedTokens` once a refresh fails non-retryably
   * (`invalid_grant`), so a present refresh token means it can still re-auth.
   */
  hasRefreshToken: boolean;
}

/**
 * `expiresAt` is the ACCESS token's lifetime (`RemoteServerConfigCtr.saveTokens`),
 * routinely in the past on a perfectly refreshable login, so it never decides
 * whether a profile is signed in.
 */
export const readTokenState = async (profile: string, now = Date.now()): Promise<TokenState> => {
  const tokens = (await readSettings(profile))?.encryptedTokens as
    { expiresAt?: number; refreshToken?: string } | undefined;
  const hasRefreshToken = Boolean(tokens?.refreshToken);
  if (!tokens?.expiresAt) return { hasRefreshToken };
  // The field has been seen in both seconds and milliseconds.
  const expiresAt = tokens.expiresAt < 1e11 ? tokens.expiresAt * 1000 : tokens.expiresAt;
  return { accessTokenExpiresInMs: Math.round(expiresAt - now), hasRefreshToken };
};

export const profileCanReauth = async (profile: string) =>
  (await readTokenState(profile)).hasRefreshToken;

/** Copies the login items into `target` (created private), dropping install-scoped settings. */
export const copyLoginItems = async (source: string, target: string) => {
  await ensurePrivateDirectory(target);
  for (const item of LOGIN_ITEMS) {
    const from = path.join(source, item);
    if (await exists(from))
      await cp(from, path.join(target, item), { force: true, recursive: true });
  }

  const settings = await readSettings(target);
  if (!settings || !INSTALL_SCOPED_SETTINGS.some((key) => key in settings)) return;
  for (const key of INSTALL_SCOPED_SETTINGS) delete settings[key];
  await writeFile(path.join(target, SETTINGS_FILE), JSON.stringify(settings, null, 2));
};

export type SaveLoginResult = 'missing' | 'saved' | 'saved-cookie-only' | 'signed-out';

/**
 * Snapshots a stopped instance's login so the next instance starts signed in.
 * The refresh token rotates on use, so the snapshot is only valid when its
 * source never boots on that token again: take it from a profile that is about
 * to be removed. `signedIn` (asked from the live renderer before it stopped)
 * covers a cookie-only session the token check cannot see.
 */
export const saveLoginState = async (
  source: string,
  { signedIn = false, snapshotDirectory }: { signedIn?: boolean; snapshotDirectory: string },
): Promise<SaveLoginResult> => {
  if (!(await exists(source))) return 'missing';
  if (!signedIn && !(await profileCanReauth(source))) return 'signed-out';

  const staging = `${snapshotDirectory}.staging.${process.pid}`;
  await rm(staging, { force: true, recursive: true });
  // The parent may be a shared directory such as /tmp: create it, never chmod it.
  // `copyLoginItems` makes the snapshot itself private.
  await mkdir(path.dirname(snapshotDirectory), { recursive: true });
  await copyLoginItems(source, staging);
  await rm(snapshotDirectory, { force: true, recursive: true });
  await rename(staging, snapshotDirectory);
  return (await profileCanReauth(snapshotDirectory)) ? 'saved' : 'saved-cookie-only';
};

export interface LoginSource {
  directory: string;
  label: string;
}

export type SeedLoginResult =
  | { status: 'existing' }
  | { status: 'none' }
  | { canReauth: boolean; source: LoginSource; status: 'seeded' };

/**
 * Seeds a new profile from the first usable source. An existing profile is left
 * alone: it carries its own login, which a copy would overwrite. A copied login
 * is readable only between profiles that share an encryption key: on macOS a
 * profile given through `LOBE_DESKTOP_USER_DATA_DIR` uses Chromium's mock
 * keychain (`src/main/pre-app-init.ts`), so it cannot read one from the shared
 * default profile, which uses the real keychain.
 */
export const seedLoginState = async (
  target: string,
  sources: LoginSource[],
): Promise<SeedLoginResult> => {
  if (await exists(target)) return { status: 'existing' };

  for (const source of sources) {
    if (!(await exists(source.directory))) continue;

    await copyLoginItems(source.directory, target);
    return { canReauth: await profileCanReauth(target), source, status: 'seeded' };
  }

  await ensurePrivateDirectory(target);
  return { status: 'none' };
};

/** One line on whether `profile` can sign the next instance in. */
export const describeLoginState = async (label: string, profile: string, now = Date.now()) => {
  if (!(await exists(profile))) return `${label}: (absent) — ${profile}`;

  const { accessTokenExpiresInMs: remaining, hasRefreshToken } = await readTokenState(profile, now);
  const access =
    remaining === undefined
      ? 'no access-token expiry recorded'
      : remaining > 0
        ? `access token fresh for ${Math.floor(remaining / 3_600_000)}h`
        : `access token stale ${Math.floor(-remaining / 3_600_000)}h (harmless — it gets refreshed)`;

  return hasRefreshToken
    ? `${label}: refresh token PRESENT — ${access} — ${profile}`
    : `${label}: refresh token GONE (app cleared it after a failed refresh) — ${profile}`;
};
