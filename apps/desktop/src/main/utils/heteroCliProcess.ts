import { execFile } from 'node:child_process';

/**
 * Whether a live process's command line plausibly belongs to a recorded
 * heterogeneous-agent CLI run. Pids are recycled, so before an orphaned run
 * is signalled its pid must still look like the CLI that was spawned — the
 * command basename recorded at spawn time (e.g. `claude`, `codex`) or, as a
 * fallback, the agent type itself.
 */
export const commandLineLooksLikeHeteroCli = (
  commandLine: string | undefined,
  run: { agentType: string; command?: string },
): boolean => {
  if (!commandLine) return false;
  const haystack = commandLine.toLowerCase();
  const needles = [run.command, run.agentType]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase());
  return needles.some((needle) => haystack.includes(needle));
};

/** Command line of `pid` from the OS process table, or undefined when it is gone. */
export const readProcessCommandLine = (pid: number): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile(
      'ps',
      ['-o', 'command=', '-p', String(pid)],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const line = stdout.trim();
        resolve(line || undefined);
      },
    );
  });
