import { exec, execFile } from 'node:child_process';
import { platform } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { IToolDetector, ToolStatus } from '@/core/infrastructure/ToolDetectorManager';
import { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';

const execFilePromise = promisify(execFile);
const execPromise = promisify(exec);

type HeterogeneousCliAgentType = 'claude-code' | 'codex';

interface ValidatedDetectorOptions {
  description: string;
  name: string;
  priority: number;
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

const detectValidatedCommand = async (
  command: string,
  options: Pick<ValidatedDetectorOptions, 'validateFlag' | 'validateKeywords'>,
): Promise<ToolStatus> => {
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
} as const satisfies Record<
  HeterogeneousCliAgentType,
  Pick<ValidatedDetectorOptions, 'validateKeywords'>
>;

export const detectHeterogeneousCliCommand = async (
  agentType: HeterogeneousCliAgentType,
  command: string,
): Promise<ToolStatus> => {
  const validator = HETEROGENEOUS_CLI_AGENT_OPTIONS[agentType];
  if (!validator) return { available: false };

  return detectValidatedCommand(command, validator);
};

/**
 * Detector that resolves a command path via which/where, then validates
 * the binary by matching `--version` (or `--help`) output against a keyword
 * to avoid collisions with unrelated executables of the same name.
 */
const createValidatedDetector = (
  options: ValidatedDetectorOptions & {
    candidates: string[];
  },
): IToolDetector => {
  const { candidates, description, name, priority, ...validation } = options;

  return {
    description,
    async detect(): Promise<ToolStatus> {
      for (const cmd of candidates) {
        const status = await detectValidatedCommand(cmd, validation);
        if (status.available) return status;
      }

      return { available: false };
    },
    name,
    priority,
  };
};

/**
 * Claude Code CLI
 * @see https://docs.claude.com/en/docs/claude-code
 */
export const claudeCodeDetector: IToolDetector = createValidatedDetector({
  candidates: ['claude'],
  description: 'Claude Code - Anthropic official agentic coding CLI',
  name: 'claude',
  priority: 1,
  validateKeywords: ['claude code'],
});

/**
 * OpenAI Codex CLI
 * @see https://github.com/openai/codex
 */
export const codexDetector: IToolDetector = createValidatedDetector({
  candidates: ['codex'],
  description: 'Codex - OpenAI agentic coding CLI',
  name: 'codex',
  priority: 2,
  validateKeywords: ['codex'],
});

/**
 * Google Gemini CLI
 * @see https://github.com/google-gemini/gemini-cli
 */
export const geminiCliDetector: IToolDetector = createValidatedDetector({
  candidates: ['gemini'],
  description: 'Gemini CLI - Google agentic coding CLI',
  name: 'gemini',
  priority: 3,
  validateKeywords: ['gemini'],
});

/**
 * Qwen Code CLI
 * @see https://github.com/QwenLM/qwen-code
 */
export const qwenCodeDetector: IToolDetector = createValidatedDetector({
  candidates: ['qwen'],
  description: 'Qwen Code - Alibaba Qwen agentic coding CLI',
  name: 'qwen',
  priority: 4,
  validateKeywords: ['qwen'],
});

/**
 * Kimi CLI (Moonshot)
 * @see https://github.com/MoonshotAI/kimi-cli
 */
export const kimiCliDetector: IToolDetector = createValidatedDetector({
  candidates: ['kimi'],
  description: 'Kimi CLI - Moonshot AI agentic coding CLI',
  name: 'kimi',
  priority: 5,
  validateKeywords: ['kimi'],
});

/**
 * Aider - AI pair programming CLI
 * Generic command detector; name collision is unlikely.
 * @see https://github.com/Aider-AI/aider
 */
export const aiderDetector: IToolDetector = createCommandDetector('aider', {
  description: 'Aider - AI pair programming in your terminal',
  priority: 6,
});

/**
 * All CLI agent detectors
 */
export const cliAgentDetectors: IToolDetector[] = [
  claudeCodeDetector,
  codexDetector,
  geminiCliDetector,
  qwenCodeDetector,
  kimiCliDetector,
  aiderDetector,
];
