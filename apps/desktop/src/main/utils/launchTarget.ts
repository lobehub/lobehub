import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * What a launch asked the app to do.
 *
 * Two shapes end up here because two different code paths arrive at the main
 * process: a deep link (`lobehub://…`) always arrives as a URL, while a
 * shell-style launch (`LobeHub ~/Code/app`, `lh app .`, Finder's "Open With")
 * only ever carries a directory. Treating them as one type keeps a single
 * dispatch point — and a single place where "the app was not ready yet" gets
 * queued instead of dropped.
 */
export type LaunchTarget =
  { kind: 'url'; url: string } | { kind: 'path'; newWindow: boolean; path: string };

export interface ParseLaunchArgsOptions {
  /**
   * Absolute paths that identify the app itself rather than a target. In
   * development Electron receives the project directory as the first
   * positional argument, and without this it would look like "open the app's
   * own source tree".
   *
   * Empty in a packaged build: a release has no self-path argument, and a
   * stale entry would silently swallow a real target.
   */
  appPaths?: string[];
  /** Directory relative arguments resolve against. Defaults to `process.cwd()`. */
  cwd?: string;
  /** fs seams for tests. */
  isDirectory?: (absolutePath: string) => boolean;
  resolveRealPath?: (absolutePath: string) => string;
  /** URL schemes this build answers to (`lobehub`, `lobehub-nightly`, …). */
  schemes: string[];
}

/** Explicit directory argument, far less ambiguous than a bare positional. */
const OPEN_PATH_FLAG = '--open-path';
const NEW_WINDOW_FLAGS = new Set(['--new-window', '-n']);

const defaultIsDirectory = (absolutePath: string) => {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
};

/**
 * `lobehub://x` and `lobehub:x` both reach argv depending on the launcher.
 * Matching on the colon keeps a Windows drive letter (`C:\…`) out: schemes are
 * letters only, so `c:` can never collide with `lobehub:`.
 */
const isSchemeUrl = (arg: string, schemes: readonly string[]) =>
  schemes.some((scheme) => arg.toLowerCase().startsWith(`${scheme.toLowerCase()}:`));

/**
 * A path we refuse to turn into a working directory.
 *
 * `\\host\share` and `//host/share` are network paths on every platform we
 * ship to, and letting one through makes the app stat a remote share on
 * launch — on SMB that leaks NTLM credentials, and on a slow link it hangs the
 * main process before the first window paints.
 */
const isNetworkPath = (input: string) => /^[/\\]{2}/.test(input);

/**
 * Resolve one candidate into a canonical absolute directory, or null when it
 * is not one. `realpath` matters: the same folder is routinely reached through
 * a symlink (`/tmp` on macOS), and a topic bound to the real path must not be
 * treated as a different directory than the one the shell handed us.
 */
export const resolveDirectoryCandidate = (
  input: string,
  options: Pick<ParseLaunchArgsOptions, 'cwd' | 'isDirectory' | 'resolveRealPath'> = {},
): null | string => {
  const {
    cwd = process.cwd(),
    isDirectory = defaultIsDirectory,
    resolveRealPath = realpathSync,
  } = options;

  if (!input || input.includes('\0')) return null;
  if (isNetworkPath(input)) return null;

  const absolute = path.resolve(cwd, input);
  if (!isDirectory(absolute)) return null;

  try {
    return resolveRealPath(absolute);
  } catch {
    return null;
  }
};

interface PositionalScan {
  /** Value of `--open-path`, when the launcher passed one. */
  openPath?: string;
  positional: string[];
}

const collectArguments = (
  args: readonly string[],
  appPaths: readonly string[],
  cwd: string,
): PositionalScan => {
  const positional: string[] = [];
  const appPathSet = new Set(appPaths.map((appPath) => path.resolve(cwd, appPath)));
  let afterSeparator = false;
  let openPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!afterSeparator && arg === '--') {
      afterSeparator = true;
      continue;
    }

    if (!afterSeparator && arg === OPEN_PATH_FLAG) {
      openPath = args[index + 1];
      index += 1;
      continue;
    }

    if (!afterSeparator && arg.startsWith('-')) continue;

    // `electron .` marks the app's own directory, not a folder to open. The
    // CLI never relies on this branch — it passes `--open-path` — so dropping
    // the resolved match cannot take a real target away.
    if (appPathSet.has(path.resolve(cwd, arg))) continue;

    positional.push(arg);
  }

  return { openPath, positional };
};

/**
 * Read a launch target out of a command line.
 *
 * Order of preference: an explicit `--open-path`, a deep link, then the last
 * positional that actually is a directory. Every candidate is validated
 * against the filesystem, so a stray argument can never become a working
 * directory.
 *
 * Last-positional wins because launchers append their own arguments, and
 * `--open-path` must not be fatal when it does not resolve: Electron REORDERS
 * argv (switches first, positionals last), which separates `--open-path` from
 * its value and leaves the real directory at the end of the line. Failing
 * there instead of falling through silently dropped a launch — observed on a
 * real second-instance handoff before this fallback existed.
 */
export const parseLaunchArgs = (
  argv: readonly string[],
  options: ParseLaunchArgsOptions,
): LaunchTarget | null => {
  // argv[0] is the executable — or Electron itself in development.
  const args = argv.slice(1);
  const newWindow = args.some((arg) => NEW_WINDOW_FLAGS.has(arg));
  const cwd = options.cwd ?? process.cwd();
  const { openPath, positional } = collectArguments(args, options.appPaths ?? [], cwd);

  const resolveOptions = {
    cwd,
    isDirectory: options.isDirectory,
    resolveRealPath: options.resolveRealPath,
  };

  if (openPath !== undefined) {
    const resolved = resolveDirectoryCandidate(openPath, resolveOptions);
    if (resolved) return { kind: 'path', newWindow, path: resolved };
  }

  const url = positional.find((arg) => isSchemeUrl(arg, options.schemes));
  if (url) return { kind: 'url', url };

  for (let index = positional.length - 1; index >= 0; index -= 1) {
    const resolved = resolveDirectoryCandidate(positional[index], resolveOptions);
    if (resolved) return { kind: 'path', newWindow, path: resolved };
  }

  return null;
};

/**
 * Build a directory target from a path the OS handed us outside argv — macOS
 * delivers Finder drops and "Open With" through the `open-file` event, which
 * never touches the command line.
 */
export const createPathTarget = (
  input: string,
  options: Pick<ParseLaunchArgsOptions, 'cwd' | 'isDirectory' | 'resolveRealPath'> = {},
): LaunchTarget | null => {
  const resolved = resolveDirectoryCandidate(input, options);
  return resolved ? { kind: 'path', newWindow: false, path: resolved } : null;
};
