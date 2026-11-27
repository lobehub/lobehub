import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isAutoUpdateDisabledByEnv,
  isInsideAgentRun,
  resolveCliDirName,
} from '../constants/identity';
import { cliPackageName } from '../pkg';
import { loadSettings } from '../settings';

/** Ordinary commands look for a new release at most this often. */
export const COMMAND_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A background install that has not released its lock by then is assumed dead. */
export const INSTALL_LOCK_STALE_MS = 10 * 60 * 1000;

/** Hidden command the background updater runs in a detached child. */
export const AUTO_UPDATE_WORKER_COMMAND = 'auto-update-worker';

/**
 * Commands that never start a background update: `update` installs on its own, `connect`
 * updates through its daemon maintenance, and the rest are internal or run in a hot path
 * (shell completion runs on every TAB).
 */
const SKIPPED_COMMANDS = new Set([
  AUTO_UPDATE_WORKER_COMMAND,
  'completion',
  'connect',
  'tool-worker',
  'update',
]);

const stateDir = () => path.join(os.homedir(), resolveCliDirName());
const statePath = () => path.join(stateDir(), 'auto-update.json');
export const installLockPath = () => path.join(stateDir(), 'auto-update.lock');

/**
 * Whether the running entry belongs to a package-manager global install of this CLI, the only
 * layout `npm i -g` / `pnpm add -g` can replace. A source checkout, a workspace link and the copy
 * bundled with the desktop app (`core.asar.unpacked/cli/dist`) all stay on the version they ship.
 */
export function isAutoUpdatableInstall(entry = process.argv[1]): boolean {
  if (!entry) return false;
  let resolved: string;
  try {
    resolved = fs.realpathSync(entry);
  } catch {
    return false;
  }
  const normalized = resolved.replaceAll('\\', '/');
  return normalized.includes(`/node_modules/${cliPackageName}/dist/`);
}

/**
 * Whether automatic updates apply to this process. On by default; the user turns them off with
 * `lh update --auto off` or `LOBEHUB_CLI_DISABLE_AUTOUPDATE=1`.
 *
 * CI jobs, LobeHub agent runs and managed cloud devices are skipped as well: they usually run in a machine
 * whose CLI version is chosen by its image, and a global reinstall in the middle of a run
 * would only slow it down.
 */
export function isAutoUpdateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isAutoUpdateAllowedByEnv(env) && loadSettings()?.autoUpdates !== false;
}

/** The fixed part of {@link isAutoUpdateEnabled}: what the environment allows, without the setting. */
export function isAutoUpdateAllowedByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isAutoUpdateDisabledByEnv()) return false;
  if (env.CI || isInsideAgentRun(env)) return false;
  // Managed cloud devices run the version their platform installs.
  return !env.LOBEHUB_MANAGED_DEVICE_ID;
}

interface AutoUpdateState {
  /** Epoch ms of the last background release check started by an ordinary command. */
  lastCheckAt?: number;
}

export function readAutoUpdateState(): AutoUpdateState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8')) as AutoUpdateState;
  } catch {
    return {};
  }
}

function writeAutoUpdateState(state: AutoUpdateState) {
  fs.mkdirSync(stateDir(), { mode: 0o700, recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state), { mode: 0o600 });
}

/**
 * Take the cross-process install lock. Two commands started together must not run two global
 * installs into the same directory. A lock older than {@link INSTALL_LOCK_STALE_MS} belongs to a
 * worker that was killed and is taken over.
 */
export function acquireInstallLock(now = Date.now()): boolean {
  fs.mkdirSync(stateDir(), { mode: 0o700, recursive: true });
  try {
    fs.writeFileSync(installLockPath(), String(process.pid), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
  }
  try {
    if (now - fs.statSync(installLockPath()).mtimeMs < INSTALL_LOCK_STALE_MS) return false;
    fs.rmSync(installLockPath(), { force: true });
    fs.writeFileSync(installLockPath(), String(process.pid), { flag: 'wx', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Whether a live installer holds the lock, without taking it. */
export function isInstallLockHeld(now = Date.now()): boolean {
  try {
    return now - fs.statSync(installLockPath()).mtimeMs < INSTALL_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Whether a connect daemon is installing an update through its maintenance worker
 * (`daemon/maintenance.ts`), which records the stage in `cli-maintenance/state.json`.
 * A record older than the lock timeout belongs to a worker that died.
 */
export function isDaemonInstallRunning(now = Date.now()): boolean {
  const file = path.join(stateDir(), 'cli-maintenance', 'state.json');
  try {
    if (now - fs.statSync(file).mtimeMs >= INSTALL_LOCK_STALE_MS) return false;
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { stage?: string }).stage === 'updating';
  } catch {
    return false;
  }
}

export function releaseInstallLock() {
  fs.rmSync(installLockPath(), { force: true });
}

/** The top-level command name in `argv` (after the executable and entry), if any. */
const commandName = (argv: string[]) => argv.slice(2).find((arg) => !arg.startsWith('-'));

/**
 * Start a detached background update when one is due, without delaying the command the user
 * ran. The child checks the registry and installs a newer release; it takes effect on the next
 * run, like Claude Code's own updater. Never throws: an update problem must not fail a command.
 */
export function maybeStartBackgroundUpdate(
  argv: string[] = process.argv,
  now = Date.now(),
): boolean {
  try {
    const command = commandName(argv);
    if (!command || SKIPPED_COMMANDS.has(command)) return false;
    // `lh --version` / `lh --help` style invocations are often scripted probes.
    if (argv.slice(2).some((arg) => ['-V', '--version', '-h', '--help'].includes(arg)))
      return false;
    if (!isAutoUpdateEnabled() || !isAutoUpdatableInstall(argv[1])) return false;

    const { lastCheckAt } = readAutoUpdateState();
    if (lastCheckAt && now - lastCheckAt < COMMAND_UPDATE_CHECK_INTERVAL_MS) return false;
    // Record the attempt before spawning so a failing registry is retried a day later rather
    // than on every command.
    writeAutoUpdateState({ lastCheckAt: now });

    const child = spawn(process.execPath, [argv[1], AUTO_UPDATE_WORKER_COMMAND], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
