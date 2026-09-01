import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { x, xSync } from 'tinyexec';

import { CLI_CONFIG_DIR_NAME } from '../constants/identity';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const STARTUP_TIMEOUT_MS = 30_000;

type DaemonStartupMessage = { message: string; type: 'startup-error' } | { type: 'startup-ready' };

function getLobehubDir() {
  return path.join(os.homedir(), CLI_CONFIG_DIR_NAME);
}

function getPidPath() {
  return path.join(getLobehubDir(), 'daemon.pid');
}

function getStatusPath() {
  return path.join(getLobehubDir(), 'daemon.status.json');
}

function getLogFilePath() {
  return path.join(getLobehubDir(), 'daemon.log');
}

export interface DaemonStatus {
  connectionStatus: string;
  deviceId?: string;
  gatewayUrl: string;
  pid: number;
  startedAt: string;
}

function ensureDir() {
  fs.mkdirSync(getLobehubDir(), { mode: 0o700, recursive: true });
}

// --- PID file ---

export function readPid(): number | null {
  try {
    const raw = fs.readFileSync(getPidPath(), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(getPidPath(), String(pid), { mode: 0o600 });
}

export function removePid(): void {
  try {
    fs.unlinkSync(getPidPath());
  } catch {
    // ignore
  }
}

/**
 * Check if a process with the given PID is alive.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a live PID actually belongs to a LobeHub connect daemon.
 *
 * A bare `isProcessAlive` check is not enough: if a daemon dies without cleaning
 * up `daemon.pid` (crash, `kill -9`, reboot), the OS can later reuse that PID
 * for an unrelated process. Acting on the stale PID would let `lh logout` /
 * `connect stop` SIGTERM a stranger. The daemon is always spawned as
 * `<node> … connect … --daemon-child`, so we confirm that signature in the
 * process command line before trusting the PID.
 *
 * Best-effort and deliberately conservative: if the command line can't be read
 * (e.g. `ps` is unavailable), we return `false` so callers never kill a process
 * we can't positively identify.
 */
export function isDaemonProcess(pid: number): boolean {
  try {
    // `-ww` disables column truncation so the trailing `--daemon-child` flag is
    // never cut off; stderr is silenced so a dead PID just yields an empty match.
    const { stdout } = xSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], {
      nodeOptions: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      nodePath: false,
    });
    const command = stdout.trim();
    return command.includes('--daemon-child') && command.includes('connect');
  } catch {
    return false;
  }
}

/**
 * Get the PID of a running daemon, cleaning up stale PID files.
 * Returns null if no daemon is running.
 */
export function getRunningDaemonPid(): number | null {
  const pid = readPid();
  if (pid === null) return null;

  // Require both liveness AND identity — a live-but-reused PID is treated as
  // stale so we never act on a process that isn't ours.
  if (isProcessAlive(pid) && isDaemonProcess(pid)) return pid;

  // Stale PID file — process is dead or the PID now belongs to someone else.
  removePid();
  removeStatus();
  return null;
}

// --- Status file ---

export function writeStatus(status: DaemonStatus): void {
  ensureDir();
  fs.writeFileSync(getStatusPath(), JSON.stringify(status, null, 2), { mode: 0o600 });
}

export function readStatus(): DaemonStatus | null {
  try {
    return JSON.parse(fs.readFileSync(getStatusPath(), 'utf8')) as DaemonStatus;
  } catch {
    return null;
  }
}

export function removeStatus(): void {
  try {
    fs.unlinkSync(getStatusPath());
  } catch {
    // ignore
  }
}

// --- Log file ---

export function getLogPath(): string {
  return getLogFilePath();
}

/**
 * Rotate the log file if it exceeds MAX_LOG_SIZE.
 */
export function rotateLogIfNeeded(): void {
  try {
    const stat = fs.statSync(getLogFilePath());
    if (stat.size > MAX_LOG_SIZE) {
      const rotated = getLogFilePath() + '.1';
      // Keep only one backup
      try {
        fs.unlinkSync(rotated);
      } catch {
        // ignore
      }
      fs.renameSync(getLogFilePath(), rotated);
    }
  } catch {
    // File doesn't exist yet, nothing to rotate
  }
}

/**
 * Append a timestamped line to the daemon log file.
 */
export function appendLog(line: string): void {
  ensureDir();
  rotateLogIfNeeded();
  const ts = new Date().toISOString();
  fs.appendFileSync(getLogFilePath(), `[${ts}] ${line}\n`);
}

// --- Daemon spawn ---

/**
 * Spawn the current script as a detached daemon process and wait until the
 * child completes its startup preflight.
 */
export function spawnDaemon(args: string[]): Promise<number> {
  ensureDir();

  const logFd = fs.openSync(getLogFilePath(), 'a');
  const logStartOffset = fs.fstatSync(logFd).size;

  // Re-run the same entry with --daemon-child (internal flag)
  const daemon = x(process.execPath, [...process.execArgv, ...args, '--daemon-child'], {
    nodeOptions: {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LOBEHUB_DAEMON: '1' },
      stdio: ['ignore', logFd, logFd, 'ipc'],
    },
    nodePath: false,
    persist: true,
  });
  const child = daemon.process;

  if (!child || !daemon.pid) {
    fs.closeSync(logFd);
    throw new Error('Daemon process could not start.');
  }

  const pid = daemon.pid;

  writePid(pid);
  fs.closeSync(logFd);

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
      if (child.connected) child.disconnect();
      child.unref();

      if (error) {
        removePid();
        removeStatus();
        reject(error);
        return;
      }

      resolve(pid);
    };

    const timeout = setTimeout(() => {
      daemon.kill('SIGTERM');
      finish(new Error('Daemon startup timed out. See the daemon log for details.'));
    }, STARTUP_TIMEOUT_MS);

    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const startupError = readStartupError(logStartOffset);
      finish(
        new Error(
          startupError ||
            `Daemon exited before startup completed (${signal ? `signal ${signal}` : `code ${code ?? 1}`}).`,
        ),
      );
    };
    const onMessage = (message: DaemonStartupMessage) => {
      if (message?.type === 'startup-ready') {
        finish();
      } else if (message?.type === 'startup-error') {
        finish(new Error(message.message));
      }
    };

    child.once('error', onError);
    child.once('exit', onExit);
    child.on('message', onMessage);
  });
}

function readStartupError(startOffset: number): string | undefined {
  try {
    const content = fs.readFileSync(getLogFilePath()).subarray(startOffset).toString('utf8').trim();
    const lastError = content
      .split('\n')
      .toReversed()
      .find((line) => line.includes('[ERROR]'))
      ?.trim();
    return lastError?.replace(/^(?:\[[^\]]+\]|\d{2}:\d{2}:\d{2})\s+\[ERROR\]\s+/, '');
  } catch {
    return undefined;
  }
}

function sendStartupMessage(message: DaemonStartupMessage): Promise<void> {
  if (process.env.LOBEHUB_DAEMON !== '1' || !process.send || !process.connected) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    process.send!(message, () => {
      if (process.connected) process.disconnect();
      resolve();
    });
  });
}

export function reportDaemonStartupError(message: string): Promise<void> {
  return sendStartupMessage({ message, type: 'startup-error' });
}

export function reportDaemonStartupReady(): Promise<void> {
  return sendStartupMessage({ type: 'startup-ready' });
}

/**
 * Stop the running daemon process.
 * Returns true if a process was killed, false if none was running.
 */
export function stopDaemon(): boolean {
  const pid = getRunningDaemonPid();
  if (pid === null) return false;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process may have exited between check and kill
  }

  removePid();
  removeStatus();
  return true;
}
