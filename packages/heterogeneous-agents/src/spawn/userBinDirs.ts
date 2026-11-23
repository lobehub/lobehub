import { constants } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import path from 'node:path';

/**
 * Folders that package managers, version managers and standalone installers
 * put a user's command-line tools in, for finding a CLI that PATH doesn't reach.
 *
 * A desktop app started from the Dock, the Start menu or a service manager
 * gets a lean PATH: nvm, fnm, mise and bun add their folders from a shell
 * profile, and on Windows an installer's registry PATH edit never reaches a
 * process started before it. Each agent's own well-known paths only cover the
 * installers we knew of for that agent; this sweep covers every install method
 * for every agent, so an `npm i -g` through nvm-windows, a `bun add -g`, a
 * pnpm or Volta global, a Scoop or winget shim are all found the same way.
 *
 * Node's own version folders come in the order a terminal would pick them: the
 * version manager's default first, then the rest newest first.
 */

export interface UserBinDirsOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  os?: NodeJS.Platform;
}

/** Read a variable the way Windows does: names are case-insensitive there. */
const getEnv = (env: NodeJS.ProcessEnv, name: string, os: NodeJS.Platform): string | undefined => {
  const exact = env[name]?.trim();
  if (exact || os !== 'win32') return exact || undefined;
  const lower = name.toLowerCase();
  const key = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === lower && !!env[candidate]?.trim(),
  );
  return key ? env[key]!.trim() : undefined;
};

const pathFor = (os: NodeJS.Platform) => (os === 'win32' ? path.win32 : path.posix);

const readDirNames = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir);
    return Array.isArray(entries) ? entries.map(String) : [];
  } catch {
    return [];
  }
};

const VERSION_DIR = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/** Version folder names (`v22.3.0`, `22.3.0`), newest first; others dropped. */
export const sortVersionDirsDesc = (names: string[]): string[] =>
  names
    .map((name) => ({ match: name.match(VERSION_DIR), name }))
    .filter((entry): entry is { match: RegExpMatchArray; name: string } => !!entry.match)
    .sort((a, b) => {
      for (let index = 1; index <= 3; index += 1) {
        const diff = Number(b.match[index] ?? 0) - Number(a.match[index] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })
    .map(({ name }) => name);

/**
 * Put the versions a default alias names (`22`, `v22.3.0`) ahead of the rest.
 * An alias that names no version (`lts/*`, `node`) leaves the order as it is.
 */
const defaultFirst = (versions: string[], alias: string | undefined): string[] => {
  const wanted = alias?.trim().replace(/^v/, '');
  if (!wanted || !/^\d/.test(wanted)) return versions;
  const matches = (version: string) => {
    const bare = version.replace(/^v/, '');
    return bare === wanted || bare.startsWith(`${wanted}.`);
  };
  return [...versions.filter(matches), ...versions.filter((version) => !matches(version))];
};

const readFirstLine = async (file: string): Promise<string | undefined> => {
  try {
    const content = await readFile(file, 'utf8');
    return typeof content === 'string' ? content.split(/\r?\n/)[0]?.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
};

/** `prefix=` from the user's `.npmrc`: where `npm i -g` installs when set. */
const readNpmrcPrefix = async (
  home: string,
  os: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> => {
  const fromEnv = getEnv(env, 'NPM_CONFIG_PREFIX', os) ?? getEnv(env, 'npm_config_prefix', os);
  if (fromEnv) return fromEnv;

  let content: unknown;
  try {
    content = await readFile(pathFor(os).join(home, '.npmrc'), 'utf8');
  } catch {
    return undefined;
  }
  if (typeof content !== 'string') return undefined;

  const value = content
    .match(/^\s*prefix\s*=\s*(.+?)\s*$/m)?.[1]
    ?.replaceAll(/^["']|["']$/g, '')
    .trim();
  if (!value) return undefined;
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return pathFor(os).join(home, value.slice(2));
  }
  return pathFor(os).isAbsolute(value) ? value : undefined;
};

const nodeVersionBins = async (
  versionsDir: string,
  alias: string | undefined,
  toBin: (versionDir: string) => string,
  os: NodeJS.Platform,
): Promise<string[]> =>
  defaultFirst(sortVersionDirsDesc(await readDirNames(versionsDir)), alias).map((version) =>
    toBin(pathFor(os).join(versionsDir, version)),
  );

const getWindowsUserBinDirs = async (env: NodeJS.ProcessEnv, home: string): Promise<string[]> => {
  const os = 'win32';
  const { join } = path.win32;
  const get = (name: string) => getEnv(env, name, os);
  const appData = get('APPDATA') ?? join(home, 'AppData', 'Roaming');
  const localAppData = get('LOCALAPPDATA') ?? join(home, 'AppData', 'Local');
  const programData = get('ProgramData') ?? 'C:\\ProgramData';
  const programFiles = get('ProgramFiles') ?? 'C:\\Program Files';

  // npm's global folder on Windows is the prefix itself, not `<prefix>\bin`.
  const npmPrefix = await readNpmrcPrefix(home, os, env);

  // nvm-windows keeps each Node under NVM_HOME and links the active one at
  // NVM_SYMLINK; `npm i -g` installs into that Node's own folder.
  const nvmHome = get('NVM_HOME');
  const nvmVersions = nvmHome ? await nodeVersionBins(nvmHome, undefined, (dir) => dir, os) : [];

  // fnm's default alias, then each installed Node (global CLIs live beside node.exe).
  const fnmRoots = [get('FNM_DIR'), join(appData, 'fnm'), join(localAppData, 'fnm')].filter(
    (dir): dir is string => !!dir,
  );
  const fnmDirs: string[] = [];
  for (const root of new Set(fnmRoots)) {
    fnmDirs.push(
      join(root, 'aliases', 'default'),
      ...(await nodeVersionBins(
        join(root, 'node-versions'),
        undefined,
        (dir) => join(dir, 'installation'),
        os,
      )),
    );
  }

  const miseData =
    get('MISE_DATA_DIR') ??
    (get('XDG_DATA_HOME') ? join(get('XDG_DATA_HOME')!, 'mise') : join(localAppData, 'mise'));
  const scoop = get('SCOOP') ?? join(home, 'scoop');
  const scoopGlobal = get('SCOOP_GLOBAL') ?? join(programData, 'scoop');

  return [
    // Standalone installers (Claude Code, Devin, …).
    join(home, '.local', 'bin'),
    ...(npmPrefix ? [npmPrefix] : []),
    join(appData, 'npm'),
    ...(get('PNPM_HOME') ? [get('PNPM_HOME')!] : []),
    join(localAppData, 'pnpm'),
    ...(get('BUN_INSTALL') ? [join(get('BUN_INSTALL')!, 'bin')] : []),
    join(home, '.bun', 'bin'),
    ...(get('VOLTA_HOME') ? [join(get('VOLTA_HOME')!, 'bin')] : []),
    join(localAppData, 'Volta', 'bin'),
    ...(get('NVM_SYMLINK') ? [get('NVM_SYMLINK')!] : []),
    'C:\\nvm4w\\nodejs',
    ...nvmVersions,
    ...fnmDirs,
    join(miseData, 'shims'),
    join(scoop, 'shims'),
    join(scoopGlobal, 'shims'),
    join(localAppData, 'Microsoft', 'WinGet', 'Links'),
    join(programFiles, 'WinGet', 'Links'),
    join(get('ChocolateyInstall') ?? join(programData, 'chocolatey'), 'bin'),
    join(programFiles, 'nodejs'),
    join(home, '.cargo', 'bin'),
    join(home, '.deno', 'bin'),
  ];
};

const getPosixUserBinDirs = async (env: NodeJS.ProcessEnv, home: string): Promise<string[]> => {
  const os = 'linux';
  const { join } = path.posix;
  const get = (name: string) => getEnv(env, name, os);
  const xdgData = get('XDG_DATA_HOME') ?? join(home, '.local', 'share');

  const npmPrefix = await readNpmrcPrefix(home, os, env);

  const nvmDir = get('NVM_DIR') ?? join(home, '.nvm');
  const nvmBins = await nodeVersionBins(
    join(nvmDir, 'versions', 'node'),
    await readFirstLine(join(nvmDir, 'alias', 'default')),
    (dir) => join(dir, 'bin'),
    os,
  );

  const fnmRoots = [
    get('FNM_DIR'),
    join(xdgData, 'fnm'),
    join(home, 'Library', 'Application Support', 'fnm'),
    join(home, '.fnm'),
  ].filter((dir): dir is string => !!dir);
  const fnmDirs: string[] = [];
  for (const root of new Set(fnmRoots)) {
    fnmDirs.push(
      join(root, 'aliases', 'default', 'bin'),
      ...(await nodeVersionBins(
        join(root, 'node-versions'),
        undefined,
        (dir) => join(dir, 'installation', 'bin'),
        os,
      )),
    );
  }

  const miseData = get('MISE_DATA_DIR') ?? join(xdgData, 'mise');
  const miseNodes = await nodeVersionBins(
    join(miseData, 'installs', 'node'),
    undefined,
    (dir) => join(dir, 'bin'),
    os,
  );

  return [
    join(home, '.local', 'bin'),
    ...(npmPrefix ? [join(npmPrefix, 'bin')] : []),
    join(home, '.npm-global', 'bin'),
    join(home, '.npm', 'bin'),
    ...(get('BUN_INSTALL') ? [join(get('BUN_INSTALL')!, 'bin')] : []),
    join(home, '.bun', 'bin'),
    ...(get('PNPM_HOME') ? [get('PNPM_HOME')!] : []),
    join(home, 'Library', 'pnpm'),
    join(xdgData, 'pnpm'),
    join(get('VOLTA_HOME') ?? join(home, '.volta'), 'bin'),
    ...nvmBins,
    ...fnmDirs,
    join(miseData, 'shims'),
    ...miseNodes,
    join(get('ASDF_DATA_DIR') ?? join(home, '.asdf'), 'shims'),
    join(home, '.cargo', 'bin'),
    join(home, '.deno', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/home/linuxbrew/.linuxbrew/bin',
    join(home, '.linuxbrew', 'bin'),
  ];
};

/** Candidate folders in lookup order, duplicates dropped. Existence isn't checked. */
export const getUserBinDirs = async ({
  env = process.env,
  home = homedir(),
  os = platform(),
}: UserBinDirsOptions = {}): Promise<string[]> => {
  const dirs =
    os === 'win32' ? await getWindowsUserBinDirs(env, home) : await getPosixUserBinDirs(env, home);
  const seen = new Set<string>();
  return dirs.filter((dir) => {
    const key = os === 'win32' ? dir.toLowerCase() : dir;
    if (!dir || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// `.exe` first: a native binary beats a shim beside it. A Windows file without
// one of these extensions can't be started (npm's extensionless sh shim).
const WINDOWS_EXTS = ['.exe', '.cmd', '.bat'] as const;

const isRunnableFile = async (file: string, os: NodeJS.Platform): Promise<boolean> => {
  try {
    await access(file, os === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Every runnable file named one of `names` in the user's tool folders, in
 * folder order then name order. Only files that exist are returned; each still
 * needs validating, as any folder may hold an unrelated tool of that name.
 */
export const findCommandInUserBinDirs = async (
  names: string[],
  options: UserBinDirsOptions = {},
): Promise<string[]> => {
  const os = options.os ?? platform();
  const dirs = await getUserBinDirs({ ...options, os });
  const files = dirs.flatMap((dir) =>
    names.flatMap((name) =>
      os === 'win32'
        ? WINDOWS_EXTS.map((ext) => path.win32.join(dir, `${name}${ext}`))
        : [path.posix.join(dir, name)],
    ),
  );
  const runnable = await Promise.all(files.map((file) => isRunnableFile(file, os)));
  return files.filter((_, index) => runnable[index]);
};
