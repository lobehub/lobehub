import { execFile } from 'node:child_process';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { LocalHeterogeneousAgentType } from '../config';
import { HETEROGENEOUS_AGENT_CONFIGS } from '../config';
import { resolveCliSpawnPlan } from './cliSpawn';

/**
 * Shared resolver for external CLI-agent binaries.
 *
 * This is the single source of truth for "given a command name, where is the
 * runnable binary?". It's consumed by BOTH spawn sites:
 *   - desktop main (`cliAgentBinaries` → `HeterogeneousAgentCtr`)
 *   - the `lh hetero exec` CLI (sandbox + terminal), via `resolveHeteroSpawnCommand`
 *
 * Kept dependency-free (node built-ins only) so it runs unchanged in Electron
 * main, the CLI, the server, and cloud sandboxes. Every external call is
 * wrapped with a timeout + try/catch so a hostile or missing environment
 * degrades to "unavailable" instead of hanging or throwing.
 */

const execFilePromise = promisify(execFile);

export type HeterogeneousCliAgentType = LocalHeterogeneousAgentType;

/**
 * Resolution result. A structural subset of the desktop `BinaryManager`'s
 * `BinaryStatus`, so `cliAgentBinaries` can surface these values as a
 * `BinaryStatus` without adaptation.
 */
export interface CliCommandStatus {
  available: boolean;
  error?: string;
  path?: string;
  /**
   * PATH used to resolve/validate the command, surfaced only when it differs
   * from the detector process's `process.env.PATH` (i.e. resolution fell back
   * to the login-shell PATH). A caller that spawns the resolved `path` must
   * carry this into the child's PATH, or a `#!/usr/bin/env node` shim resolved
   * here can't find `node` under the leaner inherited PATH.
   */
  resolvedPathEnv?: string;
  version?: string;
}

interface ValidateOptions {
  validateFlag?: string;
  /** Capability-probe argv. Defaults to `--help`. */
  validateHelpArgs?: string[];
  /** Additional `--help` markers that must all be present after version validation. */
  validateHelpKeywords?: string[];
  validateKeywords?: string[];
  validatePattern?: RegExp;
  versionFlag?: string;
}

interface ResolvedCommand {
  env?: NodeJS.ProcessEnv;
  path: string;
  resolvedPathEnv?: string;
}

interface RecoveredProbeEnvironment {
  env: NodeJS.ProcessEnv;
  resolvedPathEnv: string;
}

const VERSION_PATTERN = /v?(\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?)/;

const extractVersion = (versionBanner: string): string | undefined =>
  versionBanner.match(VERSION_PATTERN)?.[1];

const isWindows = () => platform() === 'win32';
let shellPathPromise: Promise<string | undefined> | undefined;
let registryPathPromise: Promise<string | undefined> | undefined;

// Reject shell syntax in user-supplied custom commands instead of treating it
// as part of a command name.
const WINDOWS_SHELL_METAS = /[&|;<>^`!"]/;

// Extensions eligible for execution on Windows. `.exe` runs directly, while
// supported `.cmd` / `.bat` shims are unwrapped by `resolveCliSpawnPlan`.
// `.ps1` and extensionless wrappers (npm sometimes drops a Unix shell script
// next to the `.cmd` shim) are deliberately excluded — we can't run them.
//
// IMPORTANT: keep PATH order (the order `where` returns), don't rank by
// extension. Preferring every `.exe` over every `.cmd` would skip an earlier
// npm `claude.cmd` in favour of a later `claude.exe` from Vite+ (see #17376).
const WINDOWS_RUNNABLE_EXTS = ['.exe', '.cmd', '.bat'] as const;

// Batch shims: runnable only after `resolveCliSpawnPlan` unwraps them into the
// real target, or through `%ComSpec%`.
const WINDOWS_SHIM_EXTS = ['.cmd', '.bat'] as const;

// cmd.exe truncates command lines beyond this, well below the 32767 that
// `CreateProcess` (and therefore the direct spawn path) allows.
const WINDOWS_SHELL_MAX_COMMAND_LINE_LENGTH = 8191;

const isWindowsRunnablePath = (line: string): boolean => {
  const lower = line.toLowerCase();
  return WINDOWS_RUNNABLE_EXTS.some((ext) => lower.endsWith(ext));
};

const isWindowsShimPath = (line: string): boolean => {
  const lower = line.toLowerCase();
  return WINDOWS_SHIM_EXTS.some((ext) => lower.endsWith(ext));
};

const pickWindowsRunnables = (lines: string[]): string[] => lines.filter(isWindowsRunnablePath);

/**
 * Whether the command already names a location instead of something to look up
 * on PATH. Windows is judged by Windows rules — `path.isAbsolute` follows the
 * host, so `C:\…` reads as a bare command name anywhere but Windows, which
 * matters for the `lh hetero exec` CLI resolving a Windows path off-host and
 * keeps this in step with `resolveCliSpawnPlan`.
 */
const isPathLikeCommand = (command: string): boolean =>
  isWindows()
    ? path.win32.isAbsolute(command) || /[\\/]/.test(command)
    : path.isAbsolute(command) || command.includes(path.sep);

const getLoginShellPath = async (): Promise<string | undefined> => {
  if (isWindows()) return undefined;

  const shell = process.env.SHELL;
  if (!shell || !path.isAbsolute(shell)) return undefined;

  try {
    const { stdout } = await execFilePromise(shell, ['-ilc', 'printf "%s" "$PATH"'], {
      timeout: 3000,
      windowsHide: true,
    });

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.includes(path.delimiter));
  } catch {
    return undefined;
  }
};

/**
 * Share one login-shell lookup between concurrent probes, but discard it once
 * settled. A later Rescan must observe PATH edits made by an installer while
 * the desktop app is already running.
 */
const getCurrentLoginShellPath = async (): Promise<string | undefined> => {
  shellPathPromise ??= getLoginShellPath().finally(() => {
    shellPathPromise = undefined;
  });
  return shellPathPromise;
};

// Machine-wide then per-user PATH, the two halves Windows concatenates into a
// process environment block.
const WINDOWS_REGISTRY_PATH_KEYS = [
  String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`,
  String.raw`HKCU\Environment`,
] as const;

// `reg query <key> /v Path` prints the key, then `<name> <type> <value>`.
const WINDOWS_REGISTRY_PATH_VALUE = /^[^\S\n]*Path[^\S\n]+REG_(?:EXPAND_)?SZ[^\S\n]+(\S.*)$/im;

// Both PATH values are REG_EXPAND_SZ, so they store `%SystemRoot%`-style
// references verbatim; `where` needs them expanded.
const expandWindowsEnvRefs = (value: string): string =>
  value.replaceAll(/%([^%]+)%/g, (reference, name: string) => {
    const match = Object.entries(process.env).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    return match?.[1] ?? reference;
  });

const readWindowsRegistryPathValue = async (key: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFilePromise('reg', ['query', key, '/v', 'Path'], {
      timeout: 3000,
      windowsHide: true,
    });
    const value = stdout.match(WINDOWS_REGISTRY_PATH_VALUE)?.[1]?.trim();
    return value ? expandWindowsEnvRefs(value) : undefined;
  } catch {
    return undefined;
  }
};

const readMergedWindowsRegistryPath = async (): Promise<string | undefined> => {
  if (!isWindows()) return undefined;

  const values = await Promise.all(WINDOWS_REGISTRY_PATH_KEYS.map(readWindowsRegistryPathValue));
  return mergePathValues(...values);
};

/**
 * PATH as the registry currently records it.
 *
 * A Windows process gets its environment block copied from its parent at
 * creation time and never sees later edits, so a desktop app launched from an
 * Explorer session that predates a CLI install can't find that CLI on PATH
 * even though every new shell can. This is the Windows counterpart to the
 * login-shell PATH re-read used on macOS/Linux.
 *
 * Concurrent callers share one lookup — a scan probes every agent at once —
 * but the result is deliberately NOT kept afterwards. Reading the registry
 * exists precisely to observe PATH edits this process missed, so holding the
 * answer for the process lifetime would re-create the staleness it fixes: a
 * CLI installed after the first failed scan would stay "not installed" until
 * the app restarted. `reg query` is a couple of short-lived processes, and it
 * only runs after the complete inherited-environment pass fails.
 */
const getWindowsRegistryPath = async (): Promise<string | undefined> => {
  registryPathPromise ??= readMergedWindowsRegistryPath().finally(() => {
    registryPathPromise = undefined;
  });
  return registryPathPromise;
};

const mergePathValues = (...values: Array<string | undefined>): string | undefined => {
  const seen = new Set<string>();
  const segments = values
    .flatMap((value) => value?.split(path.delimiter) ?? [])
    .map((segment) => segment.trim())
    .filter((segment) => {
      if (!segment || seen.has(segment)) return false;
      seen.add(segment);
      return true;
    });

  return segments.length > 0 ? segments.join(path.delimiter) : undefined;
};

const recoverProbeEnvironment = async (
  probeEnv?: NodeJS.ProcessEnv,
): Promise<RecoveredProbeEnvironment | undefined> => {
  const recoveredPath = isWindows()
    ? await getWindowsRegistryPath()
    : await getCurrentLoginShellPath();
  const currentPath = probeEnv?.PATH ?? process.env.PATH;
  const resolvedPathEnv = mergePathValues(recoveredPath, currentPath);

  if (!resolvedPathEnv || resolvedPathEnv === currentPath) return;

  return {
    env: {
      ...(probeEnv ?? process.env),
      PATH: resolvedPathEnv,
    },
    resolvedPathEnv,
  };
};

const getCommandPathLines = async (
  whichCommand: 'where' | 'which',
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<string[] | undefined> => {
  try {
    const { stdout } = await execFilePromise(whichCommand, [command], {
      env,
      timeout: 3000,
      windowsHide: true,
    });
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.length > 0 ? lines : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Every runnable location `which`/`where` reports for a command, in PATH order.
 *
 * Returning the whole list (rather than the first hit) matters on Windows: the
 * first `.cmd` on PATH may be a third-party wrapper we can't unwrap, while a
 * later entry is a native `.exe` that runs fine. Validating candidates in order
 * makes detection immune to unknown shim shapes instead of chasing them with
 * more regexes.
 */
const resolveCommandCandidates = async (
  command: string,
  probeEnv?: NodeJS.ProcessEnv,
): Promise<ResolvedCommand[]> => {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return [];

  const resolvedPathEnv = probeEnv?.PATH === process.env.PATH ? undefined : probeEnv?.PATH;

  if (isPathLikeCommand(trimmedCommand)) {
    return [{ env: probeEnv, path: trimmedCommand, resolvedPathEnv }];
  }

  const whichCommand = isWindows() ? 'where' : 'which';
  const lines = await getCommandPathLines(whichCommand, trimmedCommand, probeEnv);
  if (!lines) return [];

  // Windows `where` lists every PATHEXT match (e.g. for `codex` npm ships a
  // Unix shell wrapper alongside `codex.cmd` and `codex.ps1`). Keep only the
  // ones we can execute, still in PATH order.
  if (isWindows()) {
    return pickWindowsRunnables(lines).map((runnablePath) => ({
      env: probeEnv,
      path: runnablePath,
      resolvedPathEnv,
    }));
  }

  return [{ env: probeEnv, path: lines[0], resolvedPathEnv }];
};

const quoteWindowsShellToken = (token: string): string =>
  /[\t ]/.test(token) ? `"${token}"` : token;

/**
 * `execFile` arguments that run `<executable> <args>` through `%ComSpec%`.
 *
 * DETECTION ONLY. The probe's arguments are the literal `--version` /`--help`
 * flag, so nothing user-controlled reaches cmd.exe; routing the real agent
 * launch through a shell would hand cmd.exe the prompt and conversation
 * context and re-open CVE-2024-27980. Returns undefined when the command line
 * can't be built safely.
 */
const buildWindowsShellProbe = (
  executable: string,
  args: string[],
): { args: string[]; command: string } | undefined => {
  const comSpec =
    process.env.ComSpec ||
    (process.env.SystemRoot
      ? path.win32.join(process.env.SystemRoot, 'System32', 'cmd.exe')
      : undefined);
  if (!comSpec) return undefined;

  const tokens = [executable, ...args];
  if (tokens.some((token) => WINDOWS_SHELL_METAS.test(token))) return undefined;

  // `cmd /s /c` strips one leading and one trailing quote from its argument,
  // so wrap the already-quoted command line in an extra pair. The executable
  // is always quoted — it's a `where` result and can hold spaces — while the
  // flag is left bare.
  const commandLine = `"${[`"${executable}"`, ...args.map(quoteWindowsShellToken)].join(' ')}"`;
  const requiredLength = `${quoteWindowsShellToken(comSpec)} /d /s /c ${commandLine}`.length + 1;
  if (requiredLength > WINDOWS_SHELL_MAX_COMMAND_LINE_LENGTH) return undefined;

  return { args: ['/d', '/s', '/c', commandLine], command: comSpec };
};

/**
 * A `.cmd`/`.bat` candidate that `resolveCliSpawnPlan` couldn't unwrap into a
 * real executable. Since the CVE-2024-27980 fix (Node 18.20.2 / 20.12.2)
 * `execFile` refuses to spawn those without a shell, so running one directly is
 * a guaranteed `EINVAL` — the caller retries it through `%ComSpec%` once every
 * directly-runnable candidate has had its turn.
 */
const UNRESOLVED_SHIM = Symbol('unresolved-shim');

const execProbe = async (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  viaShell: boolean,
) => {
  if (viaShell) {
    const shellProbe = buildWindowsShellProbe(command, args);
    if (!shellProbe) return UNRESOLVED_SHIM;

    return execFilePromise(shellProbe.command, shellProbe.args, {
      env,
      timeout: 5000,
      windowsHide: true,
    });
  }

  const spawnPlan = await resolveCliSpawnPlan(command, args, env);
  if (isWindows() && spawnPlan.command === command && isWindowsShimPath(command)) {
    return UNRESOLVED_SHIM;
  }

  return execFilePromise(spawnPlan.command, spawnPlan.args, {
    env,
    timeout: 5000,
    windowsHide: true,
  });
};

/**
 * Resolve a command via which/where, then confirm it's the binary we expect by
 * matching `--version` output against a keyword or output pattern (avoids
 * collisions with an unrelated executable of the same name).
 */
const detectValidatedCommandInEnvironment = async (
  command: string,
  options: ValidateOptions,
  probeEnv?: NodeJS.ProcessEnv,
): Promise<CliCommandStatus> => {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return { available: false };
  if (isWindows() && WINDOWS_SHELL_METAS.test(trimmedCommand)) return { available: false };

  const {
    validateFlag = '--version',
    validateHelpArgs = ['--help'],
    validateHelpKeywords,
    validateKeywords,
    validatePattern,
    versionFlag,
  } = options;

  // Resolve via where/which BEFORE invoking. On Windows this is what discovers
  // npm-installed shims like `claude.cmd` under %APPDATA%\npm — `execFile`
  // alone won't apply PATHEXT and can't run .cmd files directly.
  const candidates = await resolveCommandCandidates(trimmedCommand, probeEnv);
  const resolvedPathEnv = probeEnv?.PATH === process.env.PATH ? undefined : probeEnv?.PATH;
  if (candidates.length === 0) {
    return resolvedPathEnv ? { available: false, resolvedPathEnv } : { available: false };
  }

  const validateCandidate = async (
    { env, path: resolvedPath, resolvedPathEnv }: ResolvedCommand,
    viaShell: boolean,
  ): Promise<CliCommandStatus | typeof UNRESOLVED_SHIM> => {
    let result;
    try {
      result = await execProbe(resolvedPath, [validateFlag], env, viaShell);
    } catch {
      return { available: false };
    }
    if (result === UNRESOLVED_SHIM) return UNRESOLVED_SHIM;

    const output = `${result.stdout}\n${result.stderr}`.trim();
    const firstLine = output.split(/\r?\n/)[0]!.trim();
    const loweredOutput = output.toLowerCase();
    const matchesKeyword = validateKeywords?.some((keyword) =>
      loweredOutput.includes(keyword.toLowerCase()),
    );
    // Anchored patterns usually describe a one-line version banner, so test the
    // first line — the same line reported as `version` below. Also test the full
    // output for CLIs such as Cursor whose product signature spans help lines.
    // One-line `^…$` patterns remain insulated from stderr notices because they
    // cannot match multi-line output without the multiline flag.
    const matchesPattern = validatePattern?.test(firstLine) || validatePattern?.test(output);

    if (!matchesKeyword && !matchesPattern) {
      return { available: false };
    }

    // Some command names and version banners identify multiple products. When
    // configured, capability-probe the exact resolved binary before accepting
    // it as the runtime this adapter needs.
    if (validateHelpKeywords?.length) {
      let helpResult;
      try {
        helpResult = await execProbe(resolvedPath, validateHelpArgs, env, viaShell);
      } catch {
        return { available: false };
      }
      if (helpResult === UNRESOLVED_SHIM) return UNRESOLVED_SHIM;

      const helpOutput = `${helpResult.stdout}\n${helpResult.stderr}`.toLowerCase();
      if (!validateHelpKeywords.every((keyword) => helpOutput.includes(keyword.toLowerCase()))) {
        return { available: false };
      }
    }

    let versionBanner = firstLine;
    if (versionFlag && versionFlag !== validateFlag) {
      try {
        const versionResult = await execProbe(resolvedPath, [versionFlag], env, viaShell);
        if (versionResult !== UNRESOLVED_SHIM) {
          versionBanner = `${versionResult.stdout}\n${versionResult.stderr}`
            .trim()
            .split(/\r?\n/)[0]!
            .trim();
        }
      } catch {
        // Validation already proved the binary is available. Older releases
        // may not support the separate version flag, so keep the successful
        // detection and omit its version instead of reporting it unavailable.
        versionBanner = '';
      }
    }

    return {
      available: true,
      path: resolvedPath,
      // Surface a caller-supplied or recovered PATH when it differs from the
      // detector process, so the spawn site can preserve the environment that
      // made validation succeed. Otherwise an `#!/usr/bin/env node` shim can
      // validate here but fail when launched from a leaner host environment.
      resolvedPathEnv,
      // CLIs format their banners differently (`codex-cli 0.147.0`,
      // `1.2.3 (Claude Code)`, etc.). Keep validation against the original
      // output, but expose only the version so every consumer renders the same
      // value. A product-only banner is availability evidence, not a version.
      version: extractVersion(versionBanner),
    };
  };

  // Pass 1: every candidate in PATH order, spawned directly. Stop at the first
  // one whose `--version` output identifies it as the binary we're after.
  const unresolvedShims: ResolvedCommand[] = [];
  for (const candidate of candidates) {
    const status = await validateCandidate(candidate, false);
    if (status === UNRESOLVED_SHIM) {
      unresolvedShims.push(candidate);
      continue;
    }
    if (status.available) return status;
  }

  // Pass 2: shims no candidate ahead of them could replace. cmd.exe runs them
  // whatever their shape, which is the only thing that reaches a CLI installed
  // solely behind a wrapper we can't parse.
  for (const candidate of unresolvedShims) {
    const status = await validateCandidate(candidate, true);
    if (status !== UNRESOLVED_SHIM && status.available) return status;
  }

  return resolvedPathEnv ? { available: false, resolvedPathEnv } : { available: false };
};

const isProbeableCommand = (command: string): boolean => {
  const trimmedCommand = command.trim();
  return trimmedCommand.length > 0 && !(isWindows() && WINDOWS_SHELL_METAS.test(trimmedCommand));
};

/**
 * Validate an ordered command chain with candidate precedence above environment
 * precedence: candidate 1 inherited → candidate 1 recovered → candidate 2
 * inherited → candidate 2 recovered. PATH recovery is attempted at most once
 * and reused, so lookup misses and validation failures share the same edge
 * without letting a well-known fallback outrank the user's login-PATH command.
 */
export const detectValidatedCommandCandidates = async (
  commands: string[],
  options: ValidateOptions,
  probeEnv?: NodeJS.ProcessEnv,
): Promise<CliCommandStatus> => {
  let lastStatus: CliCommandStatus = { available: false };
  let recoveryAttempted = false;
  let recovered: RecoveredProbeEnvironment | undefined;

  for (const command of commands) {
    const inheritedStatus = await detectValidatedCommandInEnvironment(command, options, probeEnv);
    if (inheritedStatus.available) return inheritedStatus;
    lastStatus = inheritedStatus;

    // Invalid Windows shell expressions must not trigger even the registry
    // helper processes used for PATH recovery.
    if (!isProbeableCommand(command)) continue;

    if (!recoveryAttempted) {
      recoveryAttempted = true;
      recovered = await recoverProbeEnvironment(probeEnv);
    }
    if (!recovered) continue;

    const recoveredStatus = await detectValidatedCommandInEnvironment(
      command,
      options,
      recovered.env,
    );
    if (recoveredStatus.available) return recoveredStatus;
    lastStatus = recoveredStatus;
  }

  return lastStatus;
};

export const detectValidatedCommand = async (
  command: string,
  options: ValidateOptions,
  probeEnv?: NodeJS.ProcessEnv,
): Promise<CliCommandStatus> => detectValidatedCommandCandidates([command], options, probeEnv);

const HETEROGENEOUS_CLI_AGENT_OPTIONS = {
  'amp': {
    validateFlag: '--help',
    validateKeywords: ['Amp CLI'],
    versionFlag: '--version',
  },
  'claude-code': {
    validateKeywords: ['claude code'],
  },
  'codebuddy': {
    // CodeBuddy prints a bare semantic version for `--version`.
    validatePattern: /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/,
  },
  'codex': {
    validateKeywords: ['codex'],
  },
  'cursor': {
    validateFlag: '--help',
    validatePattern: /^Usage: agent[\s\S]*Cursor Agent/im,
  },
  'droid': {
    validateHelpArgs: ['exec', '--help'],
    validateHelpKeywords: ['--output-format', 'ACP modes'],
    validatePattern: /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/,
  },
  'grok-build': {
    validateHelpArgs: ['agent', '--help'],
    validateHelpKeywords: ['agent', 'stdio'],
    validateKeywords: ['grok'],
    validatePattern:
      /^grok\s+v?\d+\.\d+\.\d+(?:[-+][\dA-Z.-]+)?(?:\s+\([^)]+\))?(?:\s+\[[^\]]+\])?$/i,
  },
  'kimi-code': {
    validateHelpKeywords: ['--prompt', '--output-format'],
    validatePattern: /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/,
  },
  'opencode': {
    // OpenCode prints only a bare version (for example `1.18.3`) for
    // `--version`, without a product-name prefix.
    validatePattern: /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/,
  },
  'pi': {
    // Pi prints a bare semantic version for `--version`.
    validatePattern: /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/,
  },
  'qoder': {
    // Qoder prints a bare semantic version for `--version`.
    validatePattern: /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/,
  },
  'trae': {
    // The official binary and the unrelated open-source trajectory runner both
    // identify themselves as `trae-cli`. Distinguish them by the ACP runtime
    // LobeHub actually needs rather than by executable name or version banner.
    validateHelpArgs: ['acp', 'serve', '--help'],
    validateHelpKeywords: ['Start the ACP server', '--yolo'],
    validateKeywords: ['trae', 'traecode'],
    validatePattern: /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/,
  },
} as const satisfies Record<HeterogeneousCliAgentType, ValidateOptions>;

// The default (bare) command each agent type is shipped to run. The well-known
// fallback locations below hold *this* binary, so they may only be probed when
// the requested command is the default — never for a custom command.
export const DEFAULT_HETERO_COMMAND = Object.fromEntries(
  HETEROGENEOUS_AGENT_CONFIGS.map(({ defaultCommand, type }) => [type, defaultCommand]),
) as Record<HeterogeneousCliAgentType, string>;

// Well-known absolute install locations probed when a bare command isn't on
// PATH. This covers GUI-launched apps with a lean launchd PATH: Claude's
// official installer can put `claude` under ~/.local/bin, while the Codex
// desktop app bundles a functional CLI inside its app bundle without symlinking it.
const getWellKnownCommandPaths = (agentType: HeterogeneousCliAgentType): string[] => {
  switch (agentType) {
    case 'amp': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'amp'),
        path.join(homedir(), '.amp', 'bin', 'amp'),
        path.join(homedir(), '.bun', 'bin', 'amp'),
        path.join(homedir(), '.npm-global', 'bin', 'amp'),
        path.join(homedir(), 'Library', 'pnpm', 'amp'),
      ];
    }
    case 'claude-code': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'claude'),
        path.join(homedir(), '.bun', 'bin', 'claude'),
        path.join(homedir(), '.npm-global', 'bin', 'claude'),
        path.join(homedir(), 'Library', 'pnpm', 'claude'),
      ];
    }
    case 'codebuddy': {
      if (platform() === 'win32') {
        return [path.join(homedir(), 'AppData', 'Roaming', 'npm', 'codebuddy.cmd')];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'codebuddy'),
        path.join(homedir(), '.bun', 'bin', 'codebuddy'),
        path.join(homedir(), '.npm-global', 'bin', 'codebuddy'),
        path.join(homedir(), 'Library', 'pnpm', 'codebuddy'),
      ];
    }
    case 'codex': {
      // The Windows Codex desktop app (MSIX package `OpenAI.Codex`) drops its
      // bundled CLI here and adds the directory to the registry User PATH —
      // which an already-running process never sees. Same scenario the
      // macOS app-bundle probe below covers: "installed the app, never
      // installed the CLI".
      if (platform() === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) return [];

        return [
          path.win32.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
          // winget installs expose a stable `Links` shim alongside the package.
          path.win32.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'codex.exe'),
        ];
      }

      if (platform() !== 'darwin') return [];

      // Codex.app was renamed to ChatGPT.app. Prefer the current bundle name,
      // while keeping Codex.app as a fallback for older installations.
      return ['ChatGPT.app', 'Codex.app'].flatMap((appBundleName) => {
        const bundledCli = path.join(appBundleName, 'Contents', 'Resources', 'codex');

        return [
          path.join('/Applications', bundledCli),
          path.join(homedir(), 'Applications', bundledCli),
        ];
      });
    }
    case 'cursor': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];
      return [
        path.join(homedir(), '.local', 'bin', 'agent'),
        // Cursor's installer creates both names. Keep the unambiguous legacy
        // alias as a fallback when another CLI shadows the generic `agent`.
        path.join(homedir(), '.local', 'bin', 'cursor-agent'),
      ];
    }
    case 'droid': {
      if (platform() === 'win32') {
        return [path.join(homedir(), 'AppData', 'Roaming', 'npm', 'droid.cmd')];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'droid'),
        path.join(homedir(), '.bun', 'bin', 'droid'),
        path.join(homedir(), '.npm-global', 'bin', 'droid'),
        path.join(homedir(), 'Library', 'pnpm', 'droid'),
      ];
    }
    case 'grok-build': {
      if (platform() === 'win32') {
        return [path.join(homedir(), '.grok', 'bin', 'grok.exe')];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];
      return [path.join(homedir(), '.grok', 'bin', 'grok')];
    }
    case 'kimi-code': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];
      return [
        path.join(homedir(), '.kimi-code', 'bin', 'kimi'),
        path.join(homedir(), '.local', 'bin', 'kimi'),
        path.join(homedir(), '.bun', 'bin', 'kimi'),
        path.join(homedir(), '.npm-global', 'bin', 'kimi'),
        path.join(homedir(), 'Library', 'pnpm', 'kimi'),
      ];
    }
    case 'opencode': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.opencode', 'bin', 'opencode'),
        path.join(homedir(), '.local', 'bin', 'opencode'),
        path.join(homedir(), '.bun', 'bin', 'opencode'),
        path.join(homedir(), '.npm-global', 'bin', 'opencode'),
        path.join(homedir(), 'Library', 'pnpm', 'opencode'),
      ];
    }
    case 'pi': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'pi'),
        path.join(homedir(), '.npm-global', 'bin', 'pi'),
        path.join(homedir(), 'Library', 'pnpm', 'pi'),
      ];
    }
    case 'qoder': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'qodercli'),
        path.join(homedir(), '.bun', 'bin', 'qodercli'),
        path.join(homedir(), '.npm-global', 'bin', 'qodercli'),
        path.join(homedir(), 'Library', 'pnpm', 'qodercli'),
      ];
    }
    case 'trae': {
      if (platform() === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) return [];

        const currentBinDir = path.win32.join(localAppData, 'Programs', 'TraeCLI', 'bin');
        const legacyBinDir = path.win32.join(localAppData, 'trae-cli', 'bin');
        return [
          path.win32.join(currentBinDir, 'traex.exe'),
          path.win32.join(legacyBinDir, 'traecli.exe'),
          path.win32.join(legacyBinDir, 'trae-cli.exe'),
        ];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'traecli'),
        path.join(homedir(), '.local', 'bin', 'trae-cli'),
      ];
    }
    default: {
      return [];
    }
  }
};

export const detectHeterogeneousCliCommand = async (
  agentType: HeterogeneousCliAgentType,
  command: string,
  probeEnv?: NodeJS.ProcessEnv,
): Promise<CliCommandStatus> => {
  const validator = HETEROGENEOUS_CLI_AGENT_OPTIONS[agentType];
  if (!validator) return { available: false };

  // The default command missing from PATH may still live at a well-known install
  // location (e.g. the Codex desktop app's bundled CLI). Only probe those for the
  // default command: the well-known paths hold the *default* binary, so applying
  // them to a custom command (e.g. `claude-beta`) would silently resolve it to
  // stock `claude` instead of reporting the configured command as missing.
  const commands =
    command.trim() === DEFAULT_HETERO_COMMAND[agentType]
      ? [command, ...getWellKnownCommandPaths(agentType)]
      : [command];

  return detectValidatedCommandCandidates(commands, validator, probeEnv);
};

/**
 * Command + env a spawn site should use for an external CLI agent.
 */
export interface ResolvedHeteroCommand {
  /**
   * The command to spawn — an absolute, validated binary path when resolution
   * succeeded; otherwise the requested command left untouched (so the spawn
   * still trusts the ambient PATH, exactly as before).
   */
  command: string;
  /**
   * PATH to inject into the child env when resolution fell back to the
   * login-shell PATH; undefined when nothing extra is needed.
   */
  pathEnv?: string;
}

/**
 * Resolve the binary a spawn site (e.g. `lh hetero exec`) should launch for a
 * heterogeneous CLI agent. Best-effort and non-throwing: any failure degrades
 * to the requested command, preserving the prior PATH-trusting behavior.
 *
 * Resolution only kicks in for the DEFAULT bare command (`codex` / `claude`) —
 * the case that benefits from the well-known-path fallback (e.g. an app-bundled
 * Codex CLI when a broken `codex` shim shadows PATH). A custom command or an
 * explicit path is used verbatim, unchanged from before. This mirrors the
 * desktop controller, which resolves the default via the binary manager and
 * leaves custom commands to the caller.
 */
export const resolveHeteroSpawnCommand = async (
  agentType: HeterogeneousCliAgentType,
  command?: string,
): Promise<ResolvedHeteroCommand> => {
  const requested = command?.trim();
  const defaultCommand = DEFAULT_HETERO_COMMAND[agentType];

  // Non-default / custom / path-like command: use verbatim, no resolution.
  if (requested && requested !== defaultCommand) return { command: requested };

  if (!defaultCommand) return { command: requested ?? command ?? '' };

  try {
    const status = await detectHeterogeneousCliCommand(agentType, defaultCommand);
    if (status.available && status.path) {
      return { command: status.path, pathEnv: status.resolvedPathEnv };
    }
  } catch {
    // best-effort: fall through to the bare command below
  }

  return { command: defaultCommand };
};
