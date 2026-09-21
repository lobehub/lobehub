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
 * Whether a live process's command line plausibly belongs to a recorded
 * heterogeneous-agent CLI run. Pids are recycled, so an orphan is only
 * signalled when its command line still carries the CLI that was spawned.
 *
 * Only tokens that can BE the program are considered: the first token, or any
 * token spelled as a path (the CLI is often launched through an interpreter,
 * `node /path/bin/claude …`). A plain substring — or any argv token — would
 * accept unrelated processes that merely name it (`grep -r claude /var/log`,
 * `python /tmp/claude-cleanup.py`) and kill their whole process tree.
 */
export const commandLineLooksLikeHeteroCli = (
  commandLine: string | undefined,
  run: { agentType: string; command?: string },
): boolean => {
  if (!commandLine) return false;
  const needles = new Set(
    [run.command, run.agentType]
      .filter((value): value is string => !!value)
      .map((value) => tokenIdentity(value)),
  );
  if (needles.size === 0) return false;

  return commandLine
    .trim()
    .split(/\s+/)
    .some((token, index) => {
      const isProgramPosition = index === 0 || /[/\\]/.test(token);
      return isProgramPosition && needles.has(tokenIdentity(token));
    });
};

const run = (file: string, args: string[]): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const line = stdout.trim();
      resolve(line || undefined);
    });
  });

/** Command line of `pid` from the OS process table, or undefined when it is gone. */
export const readProcessCommandLine = (
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> =>
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
