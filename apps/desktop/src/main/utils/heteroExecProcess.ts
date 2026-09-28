import { execFile } from 'node:child_process';

/** A live `lh hetero exec` wrapper process found in the OS process table. */
export interface HeteroExecProcess {
  pid: number;
}

/**
 * Whether a process command line is an `lh hetero exec` wrapper for the given
 * operation.
 *
 * The wrapper argv is the only OS-visible identity of a device run: the native
 * agent child (e.g. `kimi-code`) carries no operation id, but it inherits the
 * wrapper's detached process group, so signalling the wrapper's group reaches it.
 */
export const isHeteroExecCommandFor = (commandLine: string, operationId: string): boolean => {
  if (!operationId) return false;

  const tokens = commandLine.trim().split(/\s+/);
  const execIndex = tokens.findIndex(
    (token, index) => token === 'hetero' && tokens[index + 1] === 'exec',
  );
  if (execIndex < 0) return false;

  for (let index = execIndex + 2; index < tokens.length; index++) {
    if (tokens[index] === '--operation-id' && tokens[index + 1] === operationId) return true;
    if (tokens[index] === `--operation-id=${operationId}`) return true;
  }

  return false;
};

/** Parses `ps -A -o pid=,args=` output into wrappers that belong to `operationId`. */
export const parseHeteroExecProcesses = (
  psOutput: string,
  operationId: string,
  selfPid: number = process.pid,
): HeteroExecProcess[] => {
  const processes: HeteroExecProcess[] = [];

  for (const rawLine of psOutput.split('\n')) {
    const line = rawLine.trimStart();
    const separator = line.search(/\s/);
    if (separator <= 0) continue;

    const pidText = line.slice(0, separator);
    if (!/^\d+$/.test(pidText)) continue;

    const pid = Number(pidText);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === selfPid) continue;
    if (!isHeteroExecCommandFor(line.slice(separator), operationId)) continue;

    processes.push({ pid });
  }

  return processes;
};

/**
 * Finds live `lh hetero exec` wrappers for an operation by asking the OS.
 *
 * Use when:
 * - The in-memory registries have no record of the operation (for example after
 *   an app restart) and cancellation must know whether a writer is still alive.
 *
 * Expects:
 * - A Unix host with `ps` (macOS, Linux). Callers must not use this on Windows.
 *
 * Returns:
 * - The matching wrapper pids; an empty list when none is running.
 * - Rejects when the process table cannot be read, so callers never mistake a
 *   failed lookup for a confirmed exit.
 */
export const findHeteroExecProcesses = (operationId: string): Promise<HeteroExecProcess[]> =>
  new Promise((resolve, reject) => {
    // `-ww` keeps long Electron + script paths from truncating the argv on macOS.
    execFile(
      'ps',
      ['-A', '-ww', '-o', 'pid=,args='],
      { maxBuffer: 32 * 1024 * 1024, timeout: 3000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(parseHeteroExecProcesses(String(stdout), operationId));
      },
    );
  });
