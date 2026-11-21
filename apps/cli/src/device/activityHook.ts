import { type ChildProcess, spawn } from 'node:child_process';

/** The hook runs at most once per this interval, however much work arrives. */
const ACTIVITY_REPORT_INTERVAL_MS = 30_000;

/**
 * How often ongoing work is checked, as a share of the interval. Checking more
 * often than the interval keeps the gap between two runs close to 30 s instead
 * of up to twice that when work starts between two checks.
 */
const ACTIVITY_CHECKS_PER_INTERVAL = 6;

/** A hook still running after this long is killed so it cannot pile up. */
const ACTIVITY_COMMAND_TIMEOUT_MS = 10_000;

export interface ActivityReporterOptions {
  /** The program and its arguments, run without a shell. */
  command: readonly string[];
  /** Work the reporter cannot see through `begin()`: agent runs, tunnels, shells. */
  isBusy?: () => boolean;
  logger: { debug: (msg: string) => void };
}

/**
 * Report "this device is doing work" to the platform by running a configured
 * command. Runs when work starts, then every interval while work continues;
 * never more than once per interval, never two at a time, never awaited by the
 * work itself. Failures are logged at debug level only.
 */
export class ActivityReporter {
  private active = 0;
  /** The hook run in progress and the timer that kills it if it hangs. */
  private current: { child: ChildProcess; killTimer: ReturnType<typeof setTimeout> } | undefined;
  private lastRunAt: number | undefined;
  private stopped = false;
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: ActivityReporterOptions) {}

  /** Mark one unit of work as started; call the returned function when it ends. */
  begin(): () => void {
    this.active++;
    this.report();
    return () => {
      this.active--;
    };
  }

  isBusy(): boolean {
    if (this.active > 0) return true;
    try {
      return this.options.isBusy?.() ?? false;
    } catch {
      return false;
    }
  }

  /** Re-report once per interval while work is still running. */
  start(): void {
    if (this.ticker || this.stopped) return;
    this.ticker = setInterval(() => {
      if (this.isBusy()) this.report();
    }, ACTIVITY_REPORT_INTERVAL_MS / ACTIVITY_CHECKS_PER_INTERVAL);
    this.ticker.unref?.();
  }

  /** Stop reporting and kill a hook that is still running. */
  stop(): void {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
    const current = this.current;
    this.current = undefined;
    if (!current) return;
    clearTimeout(current.killTimer);
    try {
      current.child.kill('SIGKILL');
    } catch {
      // Best effort: the hook may already have exited.
    }
  }

  private report(): void {
    const now = Date.now();
    if (this.stopped || this.current) return;
    if (this.lastRunAt !== undefined && now - this.lastRunAt < ACTIVITY_REPORT_INTERVAL_MS) return;
    this.lastRunAt = now;

    const { debug } = this.options.logger;
    const [file, ...args] = this.options.command;
    let child: ChildProcess;
    try {
      child = spawn(file, args, { shell: false, stdio: 'ignore', windowsHide: true });
    } catch (err) {
      debug(`Activity command could not start: ${(err as Error).message}`);
      return;
    }

    const killTimer = setTimeout(() => {
      debug(`Activity command ran longer than ${ACTIVITY_COMMAND_TIMEOUT_MS}ms, killed it`);
      child.kill('SIGKILL');
    }, ACTIVITY_COMMAND_TIMEOUT_MS);
    killTimer.unref?.();
    const current = { child, killTimer };
    this.current = current;

    let settled = false;
    /** True the first time this run ends, unless `stop()` already ended it. */
    const settle = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(killTimer);
      if (this.current !== current) return false;
      this.current = undefined;
      return true;
    };
    child.on('error', (err: Error) => {
      if (settle()) debug(`Activity command failed: ${err.message}`);
    });
    child.on('exit', (code: number | null, signal?: NodeJS.Signals | null) => {
      if (!settle()) return;
      if (code !== 0) debug(`Activity command exited with ${code ?? signal ?? 'unknown status'}`);
    });
    child.unref();
  }
}
