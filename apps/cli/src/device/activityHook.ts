import { spawn as nodeSpawn } from 'node:child_process';

/** The hook runs at most once per this interval, however much work arrives. */
export const ACTIVITY_REPORT_INTERVAL_MS = 30_000;

/**
 * How often ongoing work is checked, as a share of the interval. Checking more
 * often than the interval keeps the gap between two runs close to 30 s instead
 * of up to twice that when work starts between two checks.
 */
const ACTIVITY_CHECKS_PER_INTERVAL = 6;

/** A hook still running after this long is killed so it cannot pile up. */
export const ACTIVITY_COMMAND_TIMEOUT_MS = 10_000;

/**
 * Split a command line into a program and its arguments, without a shell.
 *
 * Words are separated by whitespace. Single quotes keep everything literal;
 * double quotes keep everything literal except `\"`, `\\`, `\$` and `` \` ``;
 * a backslash outside quotes escapes the next character. There is no variable,
 * `~` or glob expansion, and `|`, `;`, `&`, `>` and `<` are ordinary
 * characters, so the value cannot inject a second command.
 *
 * @throws when a quote is not closed or the line has no words.
 */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let inWord = false;
  let quote: '"' | "'" | undefined;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (quote === "'") {
      if (char === "'") quote = undefined;
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = undefined;
      } else if (char === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
        current += line[++i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === '\\') {
      if (i + 1 < line.length) current += line[++i];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(current);
      current = '';
      inWord = false;
    } else {
      current += char;
      inWord = true;
    }
  }

  if (quote) throw new Error(`unterminated ${quote} quote`);
  if (inWord) words.push(current);
  if (words.length === 0) throw new Error('the command is empty');

  return words;
}

interface ActivityChild {
  kill: (signal?: NodeJS.Signals) => boolean;
  on: (event: 'error' | 'exit', listener: (...args: any[]) => void) => unknown;
  unref?: () => void;
}

export interface ActivityReporterOptions {
  /** The command line from the environment; see `splitCommandLine`. */
  command: string;
  /** Default {@link ACTIVITY_REPORT_INTERVAL_MS}. */
  intervalMs?: number;
  /** Work the reporter cannot see through `begin()`: agent runs, tunnels, shells. */
  isBusy?: () => boolean;
  logger: { debug: (msg: string) => void };
  now?: () => number;
  spawn?: (file: string, args: string[]) => ActivityChild;
  /** Default {@link ACTIVITY_COMMAND_TIMEOUT_MS}. */
  timeoutMs?: number;
}

const defaultSpawn = (file: string, args: string[]): ActivityChild =>
  nodeSpawn(file, args, { shell: false, stdio: 'ignore', windowsHide: true });

/**
 * Report "this device is doing work" to the platform by running a configured
 * command. Runs when work starts, then every interval while work continues;
 * never more than once per interval, never two at a time, never awaited by the
 * work itself. Failures are logged at debug level only.
 */
export class ActivityReporter {
  private active = 0;
  private readonly argv: string[];
  private readonly intervalMs: number;
  private lastRunAt: number | undefined;
  private running = false;
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: ActivityReporterOptions) {
    this.argv = splitCommandLine(options.command);
    this.intervalMs = options.intervalMs ?? ACTIVITY_REPORT_INTERVAL_MS;
  }

  /** Mark one unit of work as started; call the returned function when it ends. */
  begin(): () => void {
    this.active++;
    this.report();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
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
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      if (this.isBusy()) this.report();
    }, this.intervalMs / ACTIVITY_CHECKS_PER_INTERVAL);
    this.ticker.unref?.();
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private report(): void {
    const now = (this.options.now ?? Date.now)();
    if (this.running) return;
    if (this.lastRunAt !== undefined && now - this.lastRunAt < this.intervalMs) return;
    this.lastRunAt = now;

    const { debug } = this.options.logger;
    const [file, ...args] = this.argv;
    let child: ActivityChild;
    try {
      child = (this.options.spawn ?? defaultSpawn)(file, args);
    } catch (err) {
      debug(`Activity command could not start: ${(err as Error).message}`);
      return;
    }

    this.running = true;
    const timeoutMs = this.options.timeoutMs ?? ACTIVITY_COMMAND_TIMEOUT_MS;
    const timer = setTimeout(() => {
      debug(`Activity command ran longer than ${timeoutMs}ms; killed it`);
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();

    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      this.running = false;
      return true;
    };
    child.on('error', (err: Error) => {
      if (settle()) debug(`Activity command failed: ${err.message}`);
    });
    child.on('exit', (code: number | null, signal?: NodeJS.Signals | null) => {
      if (!settle()) return;
      if (code !== 0) debug(`Activity command exited with ${code ?? signal ?? 'unknown status'}`);
    });
    child.unref?.();
  }
}
