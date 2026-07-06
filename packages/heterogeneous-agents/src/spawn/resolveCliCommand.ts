import { exec, execFile } from 'node:child_process';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * Shared resolver for the external CLI-agent binaries (Claude Code / Codex).
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
const execPromise = promisify(exec);

export type HeterogeneousCliAgentType = 'claude-code' | 'codex';

/**
 * Resolution result. A structural subset of the desktop `BinaryManager`'s
 * `BinaryStatus`, so `cliAgentBinaries` can surface these values as a
 * `BinaryStatus` without adaptation.
 */
export interface CliCommandStatus {
  available: boolean;
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
  validateKeywords: string[];
}

interface ResolvedCommand {
  env?: NodeJS.ProcessEnv;
  path: string;
}

const isWindows = () => platform() === 'win32';
let shellPathPromise: Promise<string | undefined> | undefined;

// Reject anything that could break out of the `cmd /c "<path>" --version`
// shell line we build for Windows .cmd shims (see `detectValidatedCommand`).
// User-supplied custom commands flow through here via `detectHeterogeneousCliCommand`.
const WINDOWS_SHELL_METAS = /[&|;<>^`!"]/;

// Extensions we can actually execute on Windows, in preference order:
// `.exe` runs directly via `execFile`, `.cmd` / `.bat` runs via `cmd.exe`.
// `.ps1` and extensionless wrappers (npm sometimes drops a Unix shell script
// next to the `.cmd` shim) are deliberately excluded — we can't run them.
const WINDOWS_RUNNABLE_EXTS = ['.exe', '.cmd', '.bat'] as const;

const pickWindowsRunnable = (lines: string[]): string | undefined => {
  for (const ext of WINDOWS_RUNNABLE_EXTS) {
    const match = lines.find((line) => line.toLowerCase().endsWith(ext));
    if (match) return match;
  }
  return undefined;
};

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

const getCachedLoginShellPath = async (): Promise<string | undefined> => {
  shellPathPromise ??= getLoginShellPath();
  return shellPathPromise;
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

const resolveCommandPath = async (command: string): Promise<ResolvedCommand | undefined> => {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return;

  if (path.isAbsolute(trimmedCommand) || trimmedCommand.includes(path.sep)) {
    return { path: trimmedCommand };
  }

  const whichCommand = isWindows() ? 'where' : 'which';
  let lines = await getCommandPathLines(whichCommand, trimmedCommand);
  let lookupEnv: NodeJS.ProcessEnv | undefined;

  if (!lines && !isWindows()) {
    const shellPath = await getCachedLoginShellPath();
    const lookupPath = mergePathValues(shellPath, process.env.PATH);

    if (lookupPath && lookupPath !== process.env.PATH) {
      const fallbackEnv = {
        ...process.env,
        PATH: lookupPath,
      };
      lines = await getCommandPathLines(whichCommand, trimmedCommand, fallbackEnv);
      if (lines) lookupEnv = fallbackEnv;
    }
  }

  if (!lines) return undefined;

  // Windows `where` lists every PATHEXT match (e.g. for `codex` npm ships
  // a Unix shell wrapper alongside `codex.cmd` and `codex.ps1`). Picking
  // the first line can land us on something we can't execute, so prefer a
  // runnable extension and bail otherwise.
  if (isWindows()) {
    const runnablePath = pickWindowsRunnable(lines);
    return runnablePath ? { path: runnablePath } : undefined;
  }

  return { env: lookupEnv, path: lines[0] };
};

/**
 * Resolve a command via which/where, then confirm it's the binary we expect by
 * matching `--version` output against a keyword (avoids collisions with an
 * unrelated executable of the same name).
 */
export const detectValidatedCommand = async (
  command: string,
  options: ValidateOptions,
): Promise<CliCommandStatus> => {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return { available: false };
  if (isWindows() && WINDOWS_SHELL_METAS.test(trimmedCommand)) return { available: false };

  const { validateFlag = '--version', validateKeywords } = options;

  // Resolve via where/which BEFORE invoking. On Windows this is what discovers
  // npm-installed shims like `claude.cmd` under %APPDATA%\npm — `execFile`
  // alone won't apply PATHEXT and can't run .cmd files directly.
  const resolvedCommand = await resolveCommandPath(trimmedCommand);
  if (!resolvedCommand) return { available: false };

  const { env, path: resolvedPath } = resolvedCommand;

  try {
    const needsShell = isWindows() && /\.(?:cmd|bat)$/i.test(resolvedPath);
    const { stderr, stdout } = needsShell
      ? await execPromise(`"${resolvedPath}" ${validateFlag}`, {
          env,
          timeout: 5000,
          windowsHide: true,
        })
      : await execFilePromise(resolvedPath, [validateFlag], {
          env,
          timeout: 5000,
          windowsHide: true,
        });
    const output = `${stdout}\n${stderr}`.trim();
    const loweredOutput = output.toLowerCase();

    if (!validateKeywords.some((keyword) => loweredOutput.includes(keyword.toLowerCase()))) {
      return { available: false };
    }

    return {
      available: true,
      path: resolvedPath,
      // `env` is set only when resolution fell back to the login-shell PATH.
      // Surface that PATH so the spawn site can carry it into the child env —
      // otherwise a `#!/usr/bin/env node` shim resolved here can't find `node`
      // under the leaner inherited PATH (Finder-launched Electron).
      resolvedPathEnv: env?.PATH,
      version: output.split(/\r?\n/)[0],
    };
  } catch {
    return { available: false };
  }
};

const HETEROGENEOUS_CLI_AGENT_OPTIONS = {
  'claude-code': {
    validateKeywords: ['claude code'],
  },
  'codex': {
    validateKeywords: ['codex'],
  },
} as const satisfies Record<HeterogeneousCliAgentType, ValidateOptions>;

// The default (bare) command each agent type is shipped to run. The well-known
// fallback locations below hold *this* binary, so they may only be probed when
// the requested command is the default — never for a custom command.
export const DEFAULT_HETERO_COMMAND: Record<HeterogeneousCliAgentType, string> = {
  'claude-code': 'claude',
  'codex': 'codex',
};

// Well-known absolute install locations probed when a bare command isn't on
// PATH. This covers GUI-launched apps with a lean launchd PATH: Claude's
// official installer can put `claude` under ~/.local/bin, while the Codex
// desktop app bundles a functional CLI inside Codex.app without symlinking it.
const getWellKnownCommandPaths = (agentType: HeterogeneousCliAgentType): string[] => {
  switch (agentType) {
    case 'claude-code': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'claude'),
        path.join(homedir(), '.bun', 'bin', 'claude'),
        path.join(homedir(), '.npm-global', 'bin', 'claude'),
        path.join(homedir(), 'Library', 'pnpm', 'claude'),
      ];
    }
    case 'codex': {
      if (platform() !== 'darwin') return [];

      const bundledCli = path.join('Codex.app', 'Contents', 'Resources', 'codex');
      return [
        path.join('/Applications', bundledCli),
        path.join(homedir(), 'Applications', bundledCli),
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
): Promise<CliCommandStatus> => {
  const validator = HETEROGENEOUS_CLI_AGENT_OPTIONS[agentType];
  if (!validator) return { available: false };

  const status = await detectValidatedCommand(command, validator);
  if (status.available) return status;

  // The default command missing from PATH may still live at a well-known install
  // location (e.g. the Codex desktop app's bundled CLI). Only probe those for the
  // default command: the well-known paths hold the *default* binary, so applying
  // them to a custom command (e.g. `claude-beta`) would silently resolve it to
  // stock `claude` instead of reporting the configured command as missing.
  if (command.trim() === DEFAULT_HETERO_COMMAND[agentType]) {
    for (const candidate of getWellKnownCommandPaths(agentType)) {
      const fallbackStatus = await detectValidatedCommand(candidate, validator);
      if (fallbackStatus.available) return fallbackStatus;
    }
  }

  return status;
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
 * the case that benefits from the well-known-path fallback (e.g. the Codex.app
 * bundled CLI when a broken `codex` shim shadows PATH). A custom command or an
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
