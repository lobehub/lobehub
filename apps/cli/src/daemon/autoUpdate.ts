import { randomUUID } from 'node:crypto';

import { isGlobalInstall } from '../commands/update';
import {
  isAutoUpdatableInstall,
  isAutoUpdateEnabled,
  isInstallLockHeld,
} from '../utils/autoUpdate';
import type { CliMaintenance } from './maintenance';

/** How often a long-running connection asks the registry for a new release. */
export const DAEMON_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** How often a found update retries while the device is busy. */
export const DAEMON_UPDATE_RETRY_INTERVAL_MS = 5 * 60 * 1000;

type Maintenance = Pick<CliMaintenance, 'afterResponse' | 'check' | 'getState' | 'restart'>;

/**
 * Keeps a `lh connect --daemon` / systemd connection on the latest release. It goes through the
 * same maintenance flow as "Update and restart" on the device page, which installs, verifies the
 * new executable starts, and only then replaces the connection. An update waits until no task,
 * terminal, request or tunnel is active, so a running job is never cut off.
 */
export class DaemonAutoUpdater {
  private timer?: NodeJS.Timeout;
  private lastCheckAt?: number;
  private lastAttemptAt?: number;
  private running = false;
  /** Resolved once: whether this entry is the global copy an update replaces. */
  private global?: boolean;

  constructor(
    private readonly options: {
      /** Activity the maintenance gate does not count, such as open tunnels. */
      isBusy?: () => boolean;
      log: (message: string) => void;
      maintenance: Maintenance;
      now?: () => number;
    },
  ) {}

  /** Whether this process should update itself; checked once, the install layout cannot change. */
  static applies(): boolean {
    return isAutoUpdateEnabled() && isAutoUpdatableInstall();
  }

  start() {
    this.timer = setInterval(() => void this.tick(), DAEMON_UPDATE_RETRY_INTERVAL_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One scheduling step. Public for tests; never throws. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Read on every tick so `lh update --auto off` reaches a running daemon.
      if (!isAutoUpdateEnabled()) return;
      this.global ??= await isGlobalInstall();
      if (!this.global) return;
      const now = (this.options.now ?? Date.now)();
      // A failed install (for example a global prefix this user cannot write) is retried at the
      // check interval, not every few minutes.
      if (
        this.lastAttemptAt !== undefined &&
        now - this.lastAttemptAt < DAEMON_UPDATE_CHECK_INTERVAL_MS
      )
        return;
      let state = await this.options.maintenance.getState();
      if (!state.supported) return;
      // A restart this process already started, from here or from the device page.
      const { operation } = state;
      if (
        operation &&
        operation.fromInstanceId === state.instanceId &&
        operation.stage !== 'failed'
      )
        return;
      // Ask the registry again every interval even with a release in hand: a device busy for
      // hours should install the newest release, not the one it saw first.
      if (
        this.lastCheckAt === undefined ||
        now - this.lastCheckAt >= DAEMON_UPDATE_CHECK_INTERVAL_MS
      ) {
        this.lastCheckAt = now;
        state = await this.options.maintenance.check();
      }
      if (!state.latestVersion) return;
      if (state.activeTasks > 0 || this.options.isBusy?.()) return;
      // A background install started by an ordinary command or `lh update` is writing the same
      // global package directory.
      if (isInstallLockHeld(now)) return;

      this.options.log(
        `Automatic update: ${state.currentVersion} → ${state.latestVersion}, restarting the connection`,
      );
      this.lastAttemptAt = now;
      await this.options.maintenance.restart({ requestId: randomUUID(), update: true });
      // The maintenance worker waits for this signal, which a device-page request sends after
      // its RPC response.
      this.options.maintenance.afterResponse();
    } catch (error) {
      this.options.log(`Automatic update skipped: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
