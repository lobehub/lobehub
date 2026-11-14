/**
 * On-disk layout of the structured Desktop logs. `scripts/desktopLogs.mts` reads
 * the same files without importing this module (it runs under plain `node`), so
 * `scripts/__tests__/desktopLogs.test.mts` pins both copies to the same values.
 */

/** Directory under the profile (`app.getPath('userData')`), so each dev instance keeps its own logs. */
export const LOG_DIRECTORY_NAME = 'logs';
export const LOG_MANIFEST_FILE = 'manifest.json';

export const LOG_PROCESSES = ['main', 'renderer'] as const;
export type LogProcess = (typeof LOG_PROCESSES)[number];

export const getLogFileName = (process: LogProcess) => `${process}.jsonl`;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
};

/**
 * Live-file ceiling before rotation. Sized for the `debug` default: a smaller
 * file rotates the incident away before anyone reads it.
 */
export const MAX_LOG_BYTES = 20 * 1024 * 1024;
/** Rotated generations kept next to the live file (`main.jsonl.1` … `.3`, oldest last). */
export const MAX_LOG_GENERATIONS = 3;

/** One line of `main.jsonl` / `renderer.jsonl`. */
export interface LogRecord {
  appVersion?: string;
  /** Extra arguments after the message, JSON-safe and secret-redacted. */
  args?: unknown[];
  level: LogLevel;
  msg: string;
  /** Logger namespace (`createLogger(ns)`), the `[Tag]` prefix of a console line, or `renderer:<window>`. */
  ns?: string;
  /** First `op_…` id in the record; joins client logs with the server's agent trace. */
  operationId?: string;
  pid: number;
  process: LogProcess;
  /** Renderer only: script location of the console call. */
  source?: string;
  /** First `tpc_…` id in the record. */
  topicId?: string;
  ts: string;
}

export interface LogManifest {
  appVersion?: string;
  /** Set when the process exits; absent while the app runs or after a kill or hard crash. */
  endedAt?: string;
  /** Process exit code at `endedAt`; non-zero means the run ended in an error, not a clean quit. */
  exitCode?: number;
  files: Record<LogProcess, string>;
  isPackaged: boolean;
  pid: number;
  startedAt: string;
  userData: string;
}

/**
 * Packaged builds keep `info` and above unless the user turns on Settings →
 * About → Debug logs, like VS Code's default log level: `debug` is ~90% of the
 * volume, carries URLs, paths and config values, and is only needed while
 * reproducing a bug. Dev always records everything.
 */
export const resolveLogLevel = ({
  debugLogging,
  isPackaged,
}: {
  debugLogging: boolean;
  isPackaged: boolean;
}): LogLevel => (!isPackaged || debugLogging ? 'debug' : 'info');
