import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type DesktopChannel = 'beta' | 'nightly' | 'stable';

export interface DesktopAppLocation {
  channel: DesktopChannel;
  /**
   * What to spawn. On macOS this is the bundle's inner executable rather than
   * `open -a`: `open` routes the argument through an Apple Event, which can
   * race the single-instance handoff and delivers the path twice.
   */
  executablePath: string;
  /** `.app` bundle on macOS, install directory elsewhere. */
  installPath: string;
}

const CHANNELS: DesktopChannel[] = ['stable', 'beta', 'nightly'];

/** Matches `productName` in scripts/electronWorkflow/setDesktopVersion.ts. */
const BUNDLE_NAMES: Record<DesktopChannel, string> = {
  beta: 'LobeHub-Beta',
  nightly: 'LobeHub-Nightly',
  stable: 'LobeHub',
};

/** The shell command `lh app --install-cli` writes. */
export const CLI_SHIM_NAME = 'lobehub';
const SHIM_MARKER = '# installed by `lh app --install-cli`';

export const isDesktopChannel = (value: string): value is DesktopChannel =>
  (CHANNELS as string[]).includes(value);

const macBundleCandidates = (channel: DesktopChannel): string[] =>
  ['/Applications', path.join(os.homedir(), 'Applications')].map((dir) =>
    path.join(dir, `${BUNDLE_NAMES[channel]}.app`),
  );

/**
 * The executable inside a `.app`. `CFBundleExecutable` is not always the
 * product name (a downstream build may rename it), so fall back to reading the
 * single binary out of `Contents/MacOS` instead of guessing again.
 */
const macExecutablePath = (bundlePath: string): null | string => {
  const macosDir = path.join(bundlePath, 'Contents', 'MacOS');
  const named = path.join(macosDir, BUNDLE_NAMES.stable);
  if (existsSync(named)) return named;

  try {
    const entries = readdirSync(macosDir);
    const binary = entries.find((entry) => {
      try {
        return statSync(path.join(macosDir, entry)).isFile();
      } catch {
        return false;
      }
    });
    return binary ? path.join(macosDir, binary) : null;
  } catch {
    return null;
  }
};

/**
 * Windows and Linux binary names are NOT derived from the channel's product
 * name. `electron-builder.mjs` pins `win.executableName` to a single constant
 * for every channel, while only the product (and therefore the install
 * directory) carries the suffix — so beta and nightly both ship
 * `LobeHub.exe` inside their own folder. Looking for `LobeHub-Beta.exe` finds
 * nothing and reports a missing installation.
 *
 * Linux leaves `executableName` unset, so the binary follows the product name;
 * the lowercase form covers a build that lowercased it.
 */
export const platformExecutableNames = (
  channel: DesktopChannel,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  if (platform === 'win32') return ['LobeHub.exe'];
  if (platform === 'linux') return [BUNDLE_NAMES[channel], BUNDLE_NAMES[channel].toLowerCase()];
  return [];
};

const toLocation = (
  channel: DesktopChannel,
  installPath: string,
  platform: NodeJS.Platform = process.platform,
): DesktopAppLocation | null => {
  if (platform === 'darwin') {
    const executablePath = macExecutablePath(installPath);
    return executablePath ? { channel, executablePath, installPath } : null;
  }

  for (const name of platformExecutableNames(channel, platform)) {
    const executablePath = path.join(installPath, name);
    if (existsSync(executablePath)) return { channel, executablePath, installPath };
  }

  return null;
};

const candidateInstallPaths = (channel: DesktopChannel): string[] => {
  if (process.platform === 'darwin') return macBundleCandidates(channel);

  const name = BUNDLE_NAMES[channel];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return [path.join(localAppData, 'Programs', name), path.join(localAppData, name)];
  }

  return [`/opt/${name}`, path.join(os.homedir(), '.local', 'opt', name), `/usr/lib/${name}`];
};

/**
 * Find an installed desktop build.
 *
 * `LOBEHUB_DESKTOP_PATH` short-circuits the search so a dev build, a
 * white-label bundle, or a copy in `~/Downloads` can be used without teaching
 * the CLI every layout. It accepts either the bundle and the executable.
 */
export const resolveDesktopApp = (
  channel?: DesktopChannel,
  env: NodeJS.ProcessEnv = process.env,
): DesktopAppLocation | null => {
  const override = env.LOBEHUB_DESKTOP_PATH;
  if (override) {
    const located = locateFromOverride(override, channel ?? 'stable');
    if (located) return located;
  }

  for (const candidateChannel of channel ? [channel] : CHANNELS) {
    for (const installPath of candidateInstallPaths(candidateChannel)) {
      if (!existsSync(installPath)) continue;
      const located = toLocation(candidateChannel, installPath);
      if (located) return located;
    }
  }

  return null;
};

const locateFromOverride = (
  override: string,
  channel: DesktopChannel,
): DesktopAppLocation | null => {
  const absolute = path.resolve(override);
  if (!existsSync(absolute)) return null;

  if (statSync(absolute).isDirectory() && absolute.endsWith('.app')) {
    return toLocation(channel, absolute);
  }
  return { channel, executablePath: absolute, installPath: path.dirname(absolute) };
};

/**
 * Scheme the installed build answers to — a nightly and a stable install
 * coexist on one machine, and each handoff has to address its own.
 */
export const schemeFor = (location: DesktopAppLocation): string =>
  location.channel === 'stable' ? 'lobehub' : `lobehub-${location.channel}`;

/**
 * Start the app detached and return as soon as it is running.
 *
 * NOT `--wait`: unlike an editor, the app is the session — blocking the shell
 * until the user quits would leave every terminal that ran `lh app` hanging.
 */
export const launchDesktopApp = (location: DesktopAppLocation, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(location.executablePath, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

/** Where the shim goes: next to the running `lh`, else `~/.local/bin`. */
export const resolveShimDirectory = (env: NodeJS.ProcessEnv = process.env): string => {
  const cliDir = env.LOBE_CLI_SHIM_DIR;
  if (cliDir) return path.resolve(cliDir);
  return path.join(os.homedir(), '.local', 'bin');
};

export const resolveShimPath = (env: NodeJS.ProcessEnv = process.env): string =>
  path.join(resolveShimDirectory(env), CLI_SHIM_NAME);

export interface InstallShimResult {
  path: string;
  written: boolean;
}

/**
 * Write a one-line `lobehub` launcher.
 *
 * It execs the bundle's executable instead of symlinking to it: a symlink
 * pins whatever channel happened to be installed at the time, so switching
 * from nightly to stable would silently keep launching the old build.
 */
export const installShim = (
  location: DesktopAppLocation,
  env: NodeJS.ProcessEnv = process.env,
): InstallShimResult => {
  const shimPath = resolveShimPath(env);
  const directory = path.dirname(shimPath);
  mkdirSync(directory, { recursive: true });

  if (existsSync(shimPath)) {
    const existing = readFileSafe(shimPath);
    // Never clobber someone else's binary that happens to share the name.
    if (existing !== null && !existing.includes(SHIM_MARKER))
      return { path: shimPath, written: false };
  }

  const script = ['#!/bin/sh', SHIM_MARKER, `exec "${location.executablePath}" "$@"`, ''].join(
    '\n',
  );

  writeFileSync(shimPath, script, 'utf8');
  chmodSync(shimPath, 0o755);
  return { path: shimPath, written: true };
};

export const uninstallShim = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const shimPath = resolveShimPath(env);
  if (!existsSync(shimPath)) return false;
  const existing = readFileSafe(shimPath);
  if (existing === null || !existing.includes(SHIM_MARKER)) return false;

  rmSync(shimPath);
  return true;
};

const readFileSafe = (filePath: string): null | string => {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
};
