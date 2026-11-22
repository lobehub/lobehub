import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import { HETEROGENEOUS_AGENT_CONFIGS } from '../config';

/**
 * Agents installed inside WSL, seen from Windows.
 *
 * A Windows host can't find a CLI that lives in a WSL distro: `where` only
 * walks the Windows PATH. Detection therefore asks each distro which agent
 * commands its login shell resolves, and reports a hit as a command of the
 * form `wsl://<distro>/<absolute linux path>`
 * (e.g. `wsl://Ubuntu/home/me/.local/bin/agent`).
 *
 * That string travels through every place a resolved command path already
 * goes (the validator, `resolveHeteroSpawnCommand`, the session options), and
 * `resolveCliSpawnPlan` turns it into a `wsl.exe` launch at the last step:
 *
 *   wsl.exe --distribution <distro> --exec env PATH=<login PATH> <linux path> …args
 *
 * - The login shell's PATH is captured at detection and set explicitly: a
 *   `--exec` child gets WSL's bare default PATH, so an nvm-installed node
 *   (and with it every `#!/usr/bin/env node` CLI) would not be found.
 * - wsl.exe starts the child in the Windows cwd translated to `/mnt/<drive>`.
 * - Absolute Windows paths in the arguments are translated the same way.
 * - Variables the spawn site sets for the agent are forwarded through
 *   `WSLENV`, never on the command line, so tokens stay out of the process
 *   list.
 */

export const WSL_COMMAND_PREFIX = 'wsl://';

export interface WslCommand {
  distro: string;
  linuxPath: string;
}

export const isWslCommand = (command: string): boolean =>
  command.trim().toLowerCase().startsWith(WSL_COMMAND_PREFIX);

export const parseWslCommand = (command: string): WslCommand | undefined => {
  const trimmed = command.trim();
  if (!isWslCommand(trimmed)) return;

  const rest = trimmed.slice(WSL_COMMAND_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return;

  const linuxPath = rest.slice(slash);
  if (linuxPath.length < 2) return;
  return { distro: rest.slice(0, slash), linuxPath };
};

export const formatWslCommand = ({ distro, linuxPath }: WslCommand): string =>
  `${WSL_COMMAND_PREFIX}${distro}${linuxPath}`;

// Concatenated rather than `path.win32.join`ed: SystemRoot is already a Windows
// path, and this keeps a test's stand-in root usable on a POSIX host.
export const getWslExecutable = (env: NodeJS.ProcessEnv = process.env): string =>
  `${(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows').replace(/[\\/]+$/, '')}\\System32\\wsl.exe`;

/**
 * `C:\Users\me\x` → `/mnt/c/Users/me/x`; `\\wsl.localhost\Ubuntu\home\me` →
 * `/home/me`. Anything that is not an absolute Windows path is returned
 * unchanged.
 */
export const toWslPath = (value: string): string => {
  const drive = value.match(/^([A-Za-z]):[\\/](.*)$/s);
  if (drive) {
    const rest = drive[2]!.replaceAll('\\', '/');
    return `/mnt/${drive[1]!.toLowerCase()}${rest ? `/${rest}` : ''}`;
  }

  const unc = value.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/i);
  if (unc) return (unc[1] ?? '\\').replaceAll('\\', '/');

  return value;
};

/** Translates a whole-path argument and the value of a `--flag=<path>` argument. */
const toWslArg = (arg: string): string => {
  const translated = toWslPath(arg);
  if (translated !== arg) return translated;

  const flag = arg.match(/^(--?[\w-]+=)(.+)$/s);
  if (!flag) return arg;
  const value = toWslPath(flag[2]!);
  return value === flag[2] ? arg : `${flag[1]}${value}`;
};

// Windows-side values that would break the Linux side if they crossed over.
const NEVER_FORWARDED = new Set([
  'appdata',
  'comspec',
  'home',
  'homedrive',
  'homepath',
  'localappdata',
  'path',
  'pathext',
  'programdata',
  'programfiles',
  'programfiles(x86)',
  'pwd',
  'shell',
  'systemroot',
  'temp',
  'tmp',
  'userprofile',
  'windir',
  'wslenv',
]);

// Credentials and settings an agent reads, forwarded even when the spawn site
// inherited them unchanged from its own process.
const FORWARDED_PREFIXES = [
  'ANTHROPIC_',
  'CLAUDE_',
  'CODEX_',
  'CURSOR_',
  'DEEPSEEK_',
  'DSH_',
  'LOBEHUB_',
  'OPENAI_',
];
const FORWARDED_PROXY = /^(?:all|http|https|no)_proxy$/i;
const ENV_NAME = /^[A-Za-z_]\w*$/;

const collectForwardedEnvNames = (env: NodeJS.ProcessEnv): string[] =>
  Object.keys(env).filter((name) => {
    if (!ENV_NAME.test(name) || NEVER_FORWARDED.has(name.toLowerCase())) return false;
    if (env[name] === undefined) return false;
    return (
      env[name] !== process.env[name] ||
      FORWARDED_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)) ||
      FORWARDED_PROXY.test(name)
    );
  });

const mergeWslEnv = (current: string | undefined, names: string[]): string => {
  const entries = (current ?? '').split(':').filter(Boolean);
  const present = new Set(entries.map((entry) => entry.split('/')[0]!.toLowerCase()));
  for (const name of names) {
    if (!present.has(name.toLowerCase())) entries.push(`${name}/u`);
  }
  return entries.join(':');
};

export interface WslSpawnPlan {
  args: string[];
  command: string;
  env?: NodeJS.ProcessEnv;
}

export const buildWslSpawnPlan = (
  { distro, linuxPath }: WslCommand,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  pathEnv: string | undefined,
): WslSpawnPlan => {
  const forwarded = env ? collectForwardedEnvNames(env) : [];
  return {
    args: [
      '--distribution',
      distro,
      '--exec',
      ...(pathEnv ? ['env', `PATH=${pathEnv}`] : []),
      linuxPath,
      ...args.map(toWslArg),
    ],
    command: getWslExecutable(env),
    env: env && forwarded.length > 0 ? { ...env, WSLENV: mergeWslEnv(env.WSLENV, forwarded) } : env,
  };
};

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

/** A stopped distro boots its VM first, which alone can take several seconds. */
const WSL_PROBE_TIMEOUT_MS = 20_000;
const WSL_LIST_TIMEOUT_MS = 5000;

const PATH_MARKER = '__LOBEHUB_WSL_PATH__=';
const COMMAND_MARKER = '__LOBEHUB_WSL_CMD__=';

/** Every command name detection may look for inside a distro. */
const WSL_PROBED_COMMANDS = [
  ...new Set([
    ...HETEROGENEOUS_AGENT_CONFIGS.map((config) => config.defaultCommand),
    // DeepSeek Harness, and Cursor's unambiguous alias for `agent`.
    'cursor-agent',
    'dsh',
  ]),
].filter((name) => /^[\w.-]+$/.test(name));

/**
 * Read from stdin by `sh -s`, so nothing in it passes through Windows
 * command-line quoting. Resolves the names in the user's own interactive login
 * shell, where nvm / volta / ~/.local/bin are set up; aliases and functions
 * are skipped by accepting only absolute paths. The interactive shell may print
 * a banner, so results are marked lines.
 */
const PROBE_SCRIPT = `lobehub_shell="\${SHELL:-/bin/sh}"
case "\${lobehub_shell##*/}" in bash|zsh|ksh|sh|dash) ;; *) lobehub_shell=/bin/sh ;; esac
"$lobehub_shell" -ilc 'printf "\\n${PATH_MARKER}%s\\n" "$PATH"; for c in "$@"; do p=$(command -v "$c" 2>/dev/null) || continue; case "$p" in /*) printf "${COMMAND_MARKER}%s=%s\\n" "$c" "$p" ;; esac; done' lobehub "$@" </dev/null
`;

interface WslRunOptions {
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeout: number;
}

const runWsl = (args: string[], { env, input, timeout }: WslRunOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | undefined, output?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output!);
    };

    const child = spawn(getWslExecutable(env), args, {
      // wsl.exe's own messages are UTF-16 unless asked otherwise.
      env: { ...(env ?? process.env), WSL_UTF8: '1' },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Timed out waiting for WSL'));
    }, timeout);

    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) finish(undefined, Buffer.concat(chunks));
      else finish(new Error(`wsl.exe exited with code ${code}`));
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input ?? '');
  });

/** Older wsl.exe builds ignore WSL_UTF8 and still answer in UTF-16LE. */
export const decodeWslOutput = (output: Buffer): string =>
  (output.includes(0) ? output.toString('utf16le') : output.toString('utf8')).replace(
    /^\uFEFF/,
    '',
  );

export const parseWslDistroList = (output: string): string[] =>
  output
    .split(/\r?\n/)
    .map((line) => line.replaceAll('\0', '').trim())
    // Docker Desktop's backing distros run no user tools.
    .filter((name) => name && !/^docker-desktop/i.test(name));

export interface WslDistroProbe {
  commands: Map<string, string>;
  pathEnv?: string;
}

export const parseWslProbeOutput = (output: string): WslDistroProbe => {
  const commands = new Map<string, string>();
  let pathEnv: string | undefined;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith(PATH_MARKER)) {
      pathEnv = line.slice(PATH_MARKER.length) || undefined;
    } else if (line.startsWith(COMMAND_MARKER)) {
      const entry = line.slice(COMMAND_MARKER.length);
      const separator = entry.indexOf('=');
      const name = entry.slice(0, separator);
      const linuxPath = entry.slice(separator + 1);
      if (separator > 0 && linuxPath.startsWith('/')) commands.set(name, linuxPath);
    }
  }

  return { commands, pathEnv };
};

let distrosPromise: Promise<string[]> | undefined;
const distroProbes = new Map<string, Promise<WslDistroProbe | undefined>>();
const settledPathEnv = new Map<string, string | undefined>();

const listWslDistros = (): Promise<string[]> => {
  distrosPromise ??= runWsl(['--list', '--quiet'], { timeout: WSL_LIST_TIMEOUT_MS })
    .then((output) => parseWslDistroList(decodeWslOutput(output)))
    // No WSL, or WSL without a distro: nothing to find.
    .catch(() => []);
  return distrosPromise;
};

const probeWslDistro = (distro: string): Promise<WslDistroProbe | undefined> => {
  let probe = distroProbes.get(distro);
  if (!probe) {
    probe = runWsl(['--distribution', distro, '--exec', 'sh', '-s', '--', ...WSL_PROBED_COMMANDS], {
      input: PROBE_SCRIPT,
      timeout: WSL_PROBE_TIMEOUT_MS,
    })
      .then((output) => {
        const result = parseWslProbeOutput(decodeWslOutput(output));
        settledPathEnv.set(distro, result.pathEnv);
        return result;
      })
      .catch(() => {
        // Don't pin a failure (a distro that was still booting): the next scan retries.
        distroProbes.delete(distro);
        return undefined;
      });
    distroProbes.set(distro, probe);
  }
  return probe;
};

/** Drop what was learned about WSL so a Rescan sees agents installed since. */
export const invalidateWslCache = (): void => {
  distrosPromise = undefined;
  distroProbes.clear();
  settledPathEnv.clear();
};

/**
 * The `wsl://` locations of `command` in every distro whose login shell
 * resolves it, in the order `wsl.exe --list` gives (the default distro first).
 * Empty off Windows.
 */
export const findWslCommandCandidates = async (command: string): Promise<string[]> => {
  if (platform() !== 'win32') return [];

  const distros = await listWslDistros();
  const probes = await Promise.all(distros.map((distro) => probeWslDistro(distro)));

  return distros.flatMap((distro, index) => {
    const linuxPath = probes[index]?.commands.get(command);
    return linuxPath ? [formatWslCommand({ distro, linuxPath })] : [];
  });
};

/** The login-shell PATH of `distro`, probing it if this process hasn't yet. */
export const getWslPathEnv = async (distro: string): Promise<string | undefined> =>
  (await probeWslDistro(distro))?.pathEnv;

/**
 * The login-shell PATH already learned for `distro`, for spawn sites that must
 * stay synchronous (the Claude Agent SDK's spawn hook). Call `getWslPathEnv`
 * beforehand on the async side.
 */
export const getSettledWslPathEnv = (distro: string): string | undefined =>
  settledPathEnv.get(distro);
