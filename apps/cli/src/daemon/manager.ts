import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

function getLobehubDir() {
  return path.join(os.homedir(), '.lobehub');
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
 * Get the PID of a running daemon, cleaning up stale PID files.
 * Returns null if no daemon is running.
 */
export function getRunningDaemonPid(): number | null {
  const pid = readPid();
  if (pid === null) return null;

  if (isProcessAlive(pid)) return pid;

  // Stale PID file — process is dead
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
 * Spawn the current script as a detached daemon process.
 * The parent writes the PID file and returns immediately.
 */
export function spawnDaemon(args: string[]): number {
  ensureDir();

  const logFd = fs.openSync(getLogFilePath(), 'a');

  // Re-run the same entry with --daemon-child (internal flag)
  const child = spawn(process.execPath, [...process.execArgv, ...args, '--daemon-child'], {
    detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LOBEHUB_DAEMON: '1' },
    stdio: ['ignore', logFd, logFd],
  });

  child.unref();
  const pid = child.pid!;

  writePid(pid);
  fs.closeSync(logFd);

  return pid;
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
