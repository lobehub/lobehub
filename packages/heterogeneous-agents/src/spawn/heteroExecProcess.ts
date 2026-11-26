import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

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

const OPERATION_ENV_KEY = 'LOBEHUB_OPERATION_ID';

/** One process seen in the OS process table, reduced to what ownership matching needs. */
export interface OperationProcessCandidate {
  /** Full argv joined by spaces. */
  commandLine: string;
  /**
   * `KEY=value` environment entries, kept apart from argv so an unrelated
   * process merely mentioning the marker in its arguments never matches.
   * Undefined when the OS denies access (another user's process).
   */
  env?: string[];
  pgid: number;
  pid: number;
}

/**
 * Whether a process belongs to the operation: either its `lh hetero exec`
 * wrapper, or any descendant whose environment carries
 * `LOBEHUB_OPERATION_ID=<id>` (the native agent and its tools inherit it from
 * `lh hetero exec`).
 */
export const isOperationProcess = (
  candidate: OperationProcessCandidate,
  operationId: string,
): boolean => {
  if (!operationId) return false;
  if (isHeteroExecCommandFor(candidate.commandLine, operationId)) return true;
  return candidate.env?.includes(`${OPERATION_ENV_KEY}=${operationId}`) ?? false;
};

/** Collects the distinct process groups owning the operation, never the caller's own. */
export const collectOperationProcessGroups = (
  candidates: OperationProcessCandidate[],
  operationId: string,
  self: { pgid?: number; pid: number } = { pid: process.pid },
): number[] => {
  const groups = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.pid === self.pid || candidate.pgid <= 1 || candidate.pgid === self.pgid) continue;
    if (isOperationProcess(candidate, operationId)) groups.add(candidate.pgid);
  }
  return [...groups];
};

const parsePsRows = (psOutput: string) => {
  const rows = new Map<number, { pgid: number; text: string }>();
  for (const rawLine of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+) (.*)$/.exec(rawLine);
    if (match) rows.set(Number(match[1]), { pgid: Number(match[2]), text: match[3].trimEnd() });
  }
  return rows;
};

/**
 * Pairs `ps -o pid=,pgid=,args=` with the same listing under `-E` (macOS /
 * BSD), where the environment is appended to argv on one line.
 *
 * Stripping the plain argv prefix leaves only the environment, so a marker in
 * an unrelated process's arguments is never read as ownership. A process whose
 * argv changed between the two snapshots (it exec'd) keeps argv matching only.
 */
export const parsePsOperationCandidates = (
  argsOutput: string,
  argsWithEnvOutput: string,
): OperationProcessCandidate[] => {
  const withEnv = parsePsRows(argsWithEnvOutput);
  const candidates: OperationProcessCandidate[] = [];

  for (const [pid, { pgid, text: commandLine }] of parsePsRows(argsOutput)) {
    const combined = withEnv.get(pid)?.text;
    const env =
      combined !== undefined && combined.startsWith(commandLine)
        ? combined.slice(commandLine.length).trim().split(/\s+/).filter(Boolean)
        : undefined;
    candidates.push({ commandLine, env, pgid, pid });
  }
  return candidates;
};

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

/** The process exited between listing and reading. */
const isGone = (error: unknown) => errorCode(error) === 'ENOENT' || errorCode(error) === 'ESRCH';

/**
 * Reads processes from a Linux procfs.
 *
 * Skips only processes confirmed gone, and reads argv alone where the kernel
 * denies the environment (another user's process). Any other read error
 * rejects, because a skipped live writer would be reported as exited.
 */
export const readProcfsOperationCandidates = async (
  procRoot = '/proc',
  readText: (file: string) => Promise<string> = (file) => readFile(file, 'utf8'),
): Promise<OperationProcessCandidate[]> => {
  const candidates: OperationProcessCandidate[] = [];

  for (const name of await readdir(procRoot)) {
    if (!/^\d+$/.test(name)) continue;
    const dir = path.join(procRoot, name);

    let stat: string;
    let cmdline: string;
    try {
      stat = await readText(path.join(dir, 'stat'));
      cmdline = await readText(path.join(dir, 'cmdline'));
    } catch (error) {
      if (isGone(error)) continue;
      throw error;
    }

    let env: string[] | undefined;
    try {
      env = (await readText(path.join(dir, 'environ'))).split('\0');
    } catch (error) {
      if (isGone(error)) continue;
      if (errorCode(error) !== 'EACCES' && errorCode(error) !== 'EPERM') throw error;
    }

    // `pid (comm) state ppid pgrp …`; comm may contain spaces and parentheses.
    const pgid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
    candidates.push({ commandLine: cmdline.split('\0').join(' '), env, pgid, pid: Number(name) });
  }
  return candidates;
};

/**
 * Per-call `ps` budget. Two calls plus the caller's 2s grace and 3s force wait
 * must fit the server's 10s cancel round trip.
 */
const PS_TIMEOUT_MS = 2000;

const runPs = (args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      'ps',
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: PS_TIMEOUT_MS, windowsHide: true },
      (error, output) => {
        if (!error) return resolve(String(output));
        // Node reports a timeout only as `Command failed`; name it so the log
        // says why the lookup gave up.
        const { killed, signal } = error as { killed?: boolean; signal?: NodeJS.Signals | null };
        reject(
          killed
            ? new Error(`ps ${args.join(' ')} timed out after ${PS_TIMEOUT_MS}ms (${signal})`, {
                cause: error,
              })
            : error,
        );
      },
    );
  });

/**
 * Finds the live process groups of an operation by asking the OS.
 *
 * Use when:
 * - No registry remembers the operation and cancellation must know whether any
 *   writer survives — including a native agent or tool whose wrapper already
 *   exited, which {@link findHeteroExecProcesses} cannot see.
 *
 * Expects:
 * - A Unix host: procfs on Linux, `ps` elsewhere. Callers must not use this on
 *   Windows.
 *
 * Returns:
 * - The distinct process group ids; an empty list when nothing is running.
 * - Rejects when the process table cannot be read, so callers never mistake a
 *   failed lookup for a confirmed exit.
 *
 * Outside Linux a live wrapper is found from argv alone. Only when no wrapper
 * survives does it read environments with `ps -E`, which is far heavier (MBs of
 * output) and was seen exceeding its timeout inside a busy connect daemon. That
 * listing covers this user's processes only: the caller cannot signal another
 * user's processes anyway.
 */
export const findOperationProcessGroups = async (operationId: string): Promise<number[]> => {
  const self = (candidates: OperationProcessCandidate[]) => ({
    pgid: candidates.find((candidate) => candidate.pid === process.pid)?.pgid,
    pid: process.pid,
  });

  if (process.platform === 'linux') {
    const candidates = await readProcfsOperationCandidates();
    return collectOperationProcessGroups(candidates, operationId, self(candidates));
  }

  const argsOutput = await runPs(['-A', '-ww', '-o', 'pid=,pgid=,args=']);
  const argvOnly = parsePsOperationCandidates(argsOutput, '');
  const wrapperGroups = collectOperationProcessGroups(argvOnly, operationId, self(argvOnly));
  if (wrapperGroups.length > 0) return wrapperGroups;

  const candidates = parsePsOperationCandidates(
    argsOutput,
    await runPs(['-U', String(process.getuid!()), '-E', '-ww', '-o', 'pid=,pgid=,args=']),
  );
  return collectOperationProcessGroups(candidates, operationId, self(candidates));
};
