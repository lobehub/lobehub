import { execFile } from 'node:child_process';

/**
 * Basename of an argv token, lowercased and without a Windows executable
 * suffix: `/usr/local/bin/claude` and `C:\\bin\\Claude.exe` both yield `claude`.
 */
const tokenIdentity = (token: string): string => {
  const name = token.split(/[/\\]/).pop() ?? token;
  return name.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '');
};

/**
 * Split a command line into argv tokens, honouring quotes. Windows'
 * `Win32_Process.CommandLine` quotes any executable installed under a path
 * with spaces (`"C:\\Program Files\\nodejs\\node.exe" …`); splitting on
 * whitespace would yield `"C:\\Program` and `Files\\nodejs\\node.exe"`, and the
 * real orphan would then fail its own identity check.
 */
export const tokenizeCommandLine = (commandLine: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: string | undefined;

  for (const char of commandLine) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);

  return tokens;
};

/**
 * Spawn-time identity of a CLI run, recorded so a later launch can tell the
 * original process from whatever inherited its pid.
 */
export interface HeteroCliProcessIdentity {
  /** Basename identity of the spawned executable, e.g. `claude` or `node`. */
  command?: string;
  /** Path of the script the executable runs, when it is an interpreter. */
  scriptPath?: string;
}

/**
 * Derive the identity to persist from a spawned child. `spawnfile` alone is not
 * enough: an npm `.cmd` shim is unwrapped into `node <cli-script>`, so the
 * executable is the generic interpreter and only the script says which CLI it
 * is (`proc.spawnargs[0]` is the program, so the script is searched after it).
 */
export const describeHeteroCliProcess = (
  spawnfile: string | undefined,
  spawnargs: readonly string[] | undefined,
): HeteroCliProcessIdentity => {
  const command = spawnfile ? tokenIdentity(spawnfile) : undefined;
  const scriptPath = (spawnargs ?? [])
    .slice(1)
    .find((arg) => !arg.startsWith('-') && /[/\\]/.test(arg));
  return { command, scriptPath };
};

/**
 * Whether a live process's command line plausibly belongs to a recorded
 * heterogeneous-agent CLI run. Pids are recycled, so an orphan is only
 * signalled when its command line still carries the CLI that was spawned.
 *
 * Two independent gates:
 * - the recorded executable has to appear where a PROGRAM can appear — the
 *   first token, or a token spelled as a path. A plain substring (or any argv
 *   token) would accept processes that merely name it (`grep -r claude`,
 *   `python /tmp/claude-cleanup.py`) and kill their whole tree.
 * - when a CLI script was recorded, that exact path must be on the line. The
 *   executable is then a shared interpreter, and `node` alone matches half the
 *   machine.
 */
export const commandLineLooksLikeHeteroCli = (
  commandLine: string | undefined,
  run: { agentType: string } & HeteroCliProcessIdentity,
): boolean => {
  if (!commandLine) return false;

  const tokens = tokenizeCommandLine(commandLine);
  if (tokens.length === 0) return false;

  if (run.scriptPath) {
    const script = run.scriptPath.toLowerCase();
    if (!tokens.some((token) => token.toLowerCase() === script)) return false;
  }

  const needles = new Set(
    [run.command, run.agentType]
      .filter((value): value is string => !!value)
      .map((value) => tokenIdentity(value)),
  );
  if (needles.size === 0) return false;

  return tokens.some((token, index) => {
    const isProgramPosition = index === 0 || /[/\\]/.test(token);
    return isProgramPosition && needles.has(tokenIdentity(token));
  });
};

/**
 * Why a process identity lookup came back without a command line. `gone` and
 * `error` must not be conflated: the first proves the process exited, the
 * second proves nothing at all.
 */
export type ProcessIdentityStatus = 'found' | 'gone' | 'error';

export interface ProcessIdentity {
  commandLine?: string;
  status: ProcessIdentityStatus;
}

const run = (file: string, args: string[]): Promise<ProcessIdentity> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => {
      const line = stdout.trim();
      if (line) {
        resolve({ commandLine: line, status: 'found' });
        return;
      }
      // A clean non-zero exit with no output is the tool saying "no such
      // process"; anything else (spawn failure, timeout, killed) leaves the
      // question open.
      const failure = error as (Error & { code?: number | string }) | null;
      const exitedCleanly = !failure || typeof failure.code === 'number';
      resolve({ status: exitedCleanly ? 'gone' : 'error' });
    });
  });

/** Identity of `pid` from the OS process table — see {@link ProcessIdentity}. */
export const readProcessIdentity = (
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessIdentity> =>
  platform === 'win32'
    ? run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      ])
    : run('ps', ['-o', 'command=', '-p', String(pid)]);

/**
 * Whether `pid` still exists. On Unix the check targets the process GROUP
 * (the CLI is spawned detached as a group leader, and its tool children share
 * the group), so a `claude` that already exited but left a `bash` behind
 * still counts as alive. Windows has no groups; the pid itself is checked.
 */
export const isProcessAlive = (
  pid: number,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  try {
    process.kill(platform === 'win32' ? pid : -pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

/**
 * Signal the whole tree rooted at `pid`. Unix: the process group (negated
 * pid). Windows: `taskkill /T /F` walks the tree; there is no graceful step.
 */
export const killProcessTreeByPid = (
  pid: number,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform,
): void => {
  if (platform === 'win32') {
    void run('taskkill', ['/pid', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
};

/** Resolves true once `pid` (its group on Unix) is gone, false on timeout. */
export const waitForProcessExit = async (
  pid: number,
  timeoutMs: number,
  options?: { isAlive?: (pid: number) => boolean; pollMs?: number },
): Promise<boolean> => {
  const isAlive = options?.isAlive ?? isProcessAlive;
  const pollMs = options?.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return true;
};
