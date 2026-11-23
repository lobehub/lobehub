import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import { HETEROGENEOUS_AGENT_CONFIGS } from '../config';

/**
 * Agents installed inside WSL, seen from Windows.
 *
 * A Windows host can't find a CLI that lives in a WSL distro: `where` only
 * walks the Windows PATH. Detection therefore asks each distro where its
 * shells and install folders have each agent command (`WSL_PROBE_SCRIPT`), and
 * reports a hit as a command of the form `wsl://<distro>/<absolute linux path>`
 * (e.g. `wsl://Ubuntu/home/me/.local/bin/agent`).
 *
 * That string travels through every place a resolved command path already
 * goes (the validator, `resolveHeteroSpawnCommand`, the session options), and
 * `resolveCliSpawnPlan` turns it into a `wsl.exe` launch at the last step:
 *
 *   wsl.exe --distribution <distro> --exec env PATH=<login PATH> <linux path> …args
 *
 * - The shell's PATH is captured at detection and set explicitly, with the
 *   binary's own folder first: a `--exec` child gets WSL's bare default PATH,
 *   so an nvm-installed node (and with it every `#!/usr/bin/env node` CLI)
 *   would not be found.
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

/** A login shell's PATH, for a distro whose probe printed none. */
const WSL_DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/**
 * The PATH the agent runs with: the distro's shell PATH with the binary's own
 * folder first. A CLI found in an install folder the shell doesn't put on PATH
 * (an nvm Node's `bin`, read only by an interactive `.bashrc`) is a
 * `#!/usr/bin/env node` script whose `node` sits right beside it.
 */
export const withWslBinaryFolder = (linuxPath: string, pathEnv: string | undefined): string => {
  const dir = linuxPath.slice(0, linuxPath.lastIndexOf('/'));
  const current = pathEnv || WSL_DEFAULT_PATH;
  if (!dir || current.split(':').includes(dir)) return current;
  return `${dir}:${current}`;
};

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
      'env',
      `PATH=${withWslBinaryFolder(linuxPath, pathEnv)}`,
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

/**
 * A stopped distro boots its VM first, which alone can take several seconds;
 * the probe then gives the user's interactive shell up to
 * `WSL_INTERACTIVE_SHELL_TIMEOUT_S` and the login shell up to
 * `WSL_LOGIN_SHELL_TIMEOUT_S`.
 */
const WSL_PROBE_TIMEOUT_MS = 30_000;
const WSL_INTERACTIVE_SHELL_TIMEOUT_S = 10;
const WSL_LOGIN_SHELL_TIMEOUT_S = 5;
/** `wsl.exe --list` can wait for WSL's service to start after a reboot. */
const WSL_LIST_TIMEOUT_MS = 15_000;

const PATH_MARKER = '__LOBEHUB_WSL_PATH__=';
const COMMAND_MARKER = '__LOBEHUB_WSL_CMD__=';
const SHELL_PATH_MARKER = '__LOBEHUB_WSL_SHELL_PATH__=';

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
 * command-line quoting. Prints the PATH an agent should run with, then every
 * place each command name (`"$@"`) is found, best first:
 *
 * 1. The user's interactive login shell's PATH (`$SHELL -ilc`), where nvm,
 *    volta and `~/.local/bin` are usually set up from `.bashrc` / `.zshrc`.
 *    Only its PATH is taken, under a timeout: an rc file that waits on input,
 *    `exec`s another shell or attaches tmux must not cost the other steps.
 * 2. A plain login shell's PATH (`sh -l`, `~/.profile`), for when step 1
 *    failed or the user's shell is one this can't drive.
 * 3. The folders installers put CLIs in whatever PATH says (`dirs` below) —
 *    every nvm / fnm / mise Node, bun, pnpm, Volta, npm's prefix — for a
 *    `.bashrc` that only adds them inside a guard a non-terminal shell skips.
 *
 * Anything on a Windows drive is skipped: WSL appends Windows' PATH to its
 * own, so `command -v codex` there can answer `/mnt/c/…/npm/codex`, Windows'
 * npm shim, which doesn't run inside Linux. Results are marked lines, as a
 * shell's rc files may print anything.
 */
export const WSL_PROBE_SCRIPT = `lh_c='${COMMAND_MARKER}'
lh_to=; command -v timeout >/dev/null 2>&1 && lh_to=timeout
lh_run() { lh_s=$1; shift; if [ -n "$lh_to" ]; then timeout "$lh_s" "$@"; else "$@"; fi; }
lh_shell="\${SHELL:-/bin/sh}"
case "\${lh_shell##*/}" in
  bash|zsh|ksh|sh|dash) lh_ip=$(lh_run ${WSL_INTERACTIVE_SHELL_TIMEOUT_S} "$lh_shell" -ilc 'printf "\\n${SHELL_PATH_MARKER}%s\\n" "$PATH"' </dev/null 2>/dev/null) ;;
  fish) lh_ip=$(lh_run ${WSL_INTERACTIVE_SHELL_TIMEOUT_S} "$lh_shell" -ilc 'printf "\\n${SHELL_PATH_MARKER}%s\\n" (string join : $PATH)' </dev/null 2>/dev/null) ;;
  *) lh_ip= ;;
esac
lh_ip=$(printf '%s\\n' "$lh_ip" | sed -n 's/^${SHELL_PATH_MARKER}//p' | tail -n 1)
lh_lp=$(lh_run ${WSL_LOGIN_SHELL_TIMEOUT_S} sh -lc 'printf "\\n${SHELL_PATH_MARKER}%s\\n" "$PATH"' </dev/null 2>/dev/null | sed -n 's/^${SHELL_PATH_MARKER}//p' | tail -n 1)
printf '\\n${PATH_MARKER}%s\\n' "\${lh_ip:-$lh_lp}"
lh_wm=$(awk '$1 ~ /^[A-Za-z]:/ {print $2}' /proc/mounts 2>/dev/null)
lh_win() { case "$1" in /mnt/[A-Za-z]/*) return 0 ;; esac; for lh_m in $lh_wm; do case "$1" in "$lh_m"/*) return 0 ;; esac; done; return 1; }
lh_emit() { case "$2" in /*) ;; *) return 0 ;; esac; lh_win "$2" && return 0; [ -f "$2" ] && [ -x "$2" ] && printf '%s%s=%s\\n' "$lh_c" "$1" "$2"; return 0; }
lh_vs() { ls "$1" 2>/dev/null | sed 's/^v*\\([0-9][0-9.]*\\).*$/\\1 &/;t;d' | sort -t. -k1,1nr -k2,2nr -k3,3nr | cut -d' ' -f2; }
lh_dirs() {
  echo "$HOME/.local/bin"
  lh_np=$(sed -n 's/^[[:space:]]*prefix[[:space:]]*=[[:space:]]*//p' "$HOME/.npmrc" 2>/dev/null | head -n 1 | tr -d "\\"'\\r")
  case "$lh_np" in "~/"*) echo "$HOME/\${lh_np#??}/bin" ;; /*) echo "$lh_np/bin" ;; esac
  echo "$HOME/.npm-global/bin"; echo "$HOME/.bun/bin"; echo "$HOME/.local/share/pnpm"; echo "$HOME/.volta/bin"
  lh_nv="\${NVM_DIR:-$HOME/.nvm}"
  lh_nd=$(head -n 1 "$lh_nv/alias/default" 2>/dev/null); lh_nd=\${lh_nd#v}
  case "$lh_nd" in [0-9]*) for lh_v in $(lh_vs "$lh_nv/versions/node"); do case "\${lh_v#v}" in "$lh_nd"|"$lh_nd".*) echo "$lh_nv/versions/node/$lh_v/bin" ;; esac; done ;; esac
  for lh_v in $(lh_vs "$lh_nv/versions/node"); do echo "$lh_nv/versions/node/$lh_v/bin"; done
  for lh_r in "$HOME/.local/share/fnm" "$HOME/.fnm"; do [ -d "$lh_r/node-versions" ] || continue; echo "$lh_r/aliases/default/bin"; for lh_v in $(lh_vs "$lh_r/node-versions"); do echo "$lh_r/node-versions/$lh_v/installation/bin"; done; done
  echo "$HOME/.local/share/mise/shims"
  for lh_v in $(lh_vs "$HOME/.local/share/mise/installs/node"); do echo "$HOME/.local/share/mise/installs/node/$lh_v/bin"; done
  echo "$HOME/.asdf/shims"; echo "$HOME/.cargo/bin"; echo "$HOME/.deno/bin"
  echo /home/linuxbrew/.linuxbrew/bin; echo "$HOME/.linuxbrew/bin"; echo /usr/local/bin; echo /snap/bin
  for lh_a in .opencode .amp .kimi-code .grok; do echo "$HOME/$lh_a/bin"; done
}
lh_ds=$(lh_dirs)
for lh_name in "$@"; do
  for lh_p in "$lh_ip" "$lh_lp" "$PATH"; do
    lh_o=$IFS; IFS=:
    for lh_d in $lh_p; do IFS=$lh_o; lh_emit "$lh_name" "$lh_d/$lh_name"; done
    IFS=$lh_o
  done
  lh_o=$IFS; IFS='
'
  for lh_d in $lh_ds; do IFS=$lh_o; lh_emit "$lh_name" "$lh_d/$lh_name"; done
  IFS=$lh_o
done
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
  /** Each command's locations inside the distro, best first. */
  commands: Map<string, string[]>;
  pathEnv?: string;
}

// The probe filters these too; this keeps a hand-run probe (or an older one)
// from handing Windows' own npm shim to a Linux launch.
const isOnWindowsDrive = (linuxPath: string): boolean => /^\/mnt\/[a-z]\//i.test(linuxPath);

export const parseWslProbeOutput = (output: string): WslDistroProbe => {
  const commands = new Map<string, string[]>();
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
      if (separator <= 0 || !linuxPath.startsWith('/') || isOnWindowsDrive(linuxPath)) continue;
      const found = commands.get(name) ?? [];
      if (!found.includes(linuxPath)) found.push(linuxPath);
      commands.set(name, found);
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
    .catch(() => {
      // No WSL, WSL without a distro, or a WSL service still starting after a
      // reboot: nothing to find this time. Not kept, so the next scan asks
      // again instead of reporting "no distros" until the app restarts.
      distrosPromise = undefined;
      return [];
    });
  return distrosPromise;
};

const probeWslDistro = (distro: string): Promise<WslDistroProbe | undefined> => {
  let probe = distroProbes.get(distro);
  if (!probe) {
    probe = runWsl(['--distribution', distro, '--exec', 'sh', '-s', '--', ...WSL_PROBED_COMMANDS], {
      input: WSL_PROBE_SCRIPT,
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
 * Every `wsl://` location of `command`: each distro in the order
 * `wsl.exe --list` gives (the default distro first), and within a distro the
 * probe's order (shell PATH first, then install folders).
 * Empty off Windows.
 */
export const findWslCommandCandidates = async (command: string): Promise<string[]> => {
  if (platform() !== 'win32') return [];

  const distros = await listWslDistros();
  const probes = await Promise.all(distros.map((distro) => probeWslDistro(distro)));

  return distros.flatMap((distro, index) =>
    (probes[index]?.commands.get(command) ?? []).map((linuxPath) =>
      formatWslCommand({ distro, linuxPath }),
    ),
  );
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
