import { writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { LogLevel, LogManifest, LogProcess } from './layout';
import {
  getLogFileName,
  LOG_DIRECTORY_NAME,
  LOG_LEVEL_RANK,
  LOG_MANIFEST_FILE,
  LOG_PROCESSES,
} from './layout';
import { createLogRecord, serializeLogRecord } from './record';
import { JsonlLogWriter } from './writer';

/**
 * Records logged before `openStructuredLogs()` (module-scope logger calls run
 * while the main bundle is still importing) wait here, bounded, and reach the
 * file once it opens.
 */
const MAX_EARLY_LINES = 1000;

export interface LogEntry {
  args?: unknown[];
  level: LogLevel;
  message: unknown;
  ns?: string;
  process: LogProcess;
  source?: string;
}

export interface OpenStructuredLogsOptions {
  appVersion?: string;
  isPackaged: boolean;
  minLevel: LogLevel;
  now?: () => Date;
  userDataPath: string;
}

interface OpenState {
  appVersion?: string;
  manifest: LogManifest;
  manifestPath: string;
  minRank: number;
  writers: Record<LogProcess, JsonlLogWriter>;
}

let state: OpenState | undefined;
let earlyEntries: { entry: LogEntry; now: Date }[] = [];
/** A level set before the files open; it wins over `minLevel` at open time. */
let pendingMinLevel: LogLevel | undefined;

const writeEntry = (open: OpenState, entry: LogEntry, now: Date) => {
  if (LOG_LEVEL_RANK[entry.level] < open.minRank) return;
  const line = serializeLogRecord(createLogRecord({ ...entry, appVersion: open.appVersion, now }));
  open.writers[entry.process].write(line, { urgent: entry.level === 'error' });
};

/** Appends one record to `<userData>/logs/<process>.jsonl`. Never throws. */
export const writeStructuredLog = (entry: LogEntry) => {
  try {
    const now = new Date();
    if (state) {
      writeEntry(state, entry, now);
    } else if (earlyEntries.length < MAX_EARLY_LINES) {
      earlyEntries.push({ entry, now });
    }
  } catch {
    // Logging must not break the caller.
  }
};

export const getStructuredLogDirectory = () =>
  state ? path.dirname(state.manifestPath) : undefined;

/**
 * Opens the log files for this run and writes `manifest.json`, which lets
 * `scripts/desktopLogs.mts` find the files and tell a live run from a dead one.
 */
export const openStructuredLogs = async ({
  appVersion,
  isPackaged,
  minLevel,
  now = () => new Date(),
  userDataPath,
}: OpenStructuredLogsOptions) => {
  if (state) return state.manifest;

  const directory = path.join(userDataPath, LOG_DIRECTORY_NAME);
  await mkdir(directory, { recursive: true });

  const files = Object.fromEntries(
    LOG_PROCESSES.map((process) => [process, getLogFileName(process)]),
  ) as Record<LogProcess, string>;
  const manifest: LogManifest = {
    ...(appVersion ? { appVersion } : undefined),
    files,
    isPackaged,
    pid: process.pid,
    startedAt: now().toISOString(),
    userData: userDataPath,
  };
  const manifestPath = path.join(directory, LOG_MANIFEST_FILE);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const open: OpenState = {
    appVersion,
    manifest,
    manifestPath,
    minRank: LOG_LEVEL_RANK[pendingMinLevel ?? minLevel],
    writers: Object.fromEntries(
      LOG_PROCESSES.map((process) => [
        process,
        new JsonlLogWriter({ filePath: path.join(directory, files[process]), process }),
      ]),
    ) as Record<LogProcess, JsonlLogWriter>,
  };
  state = open;

  for (const { entry, now: at } of earlyEntries) writeEntry(open, entry, at);
  earlyEntries = [];

  process.once('exit', (exitCode) => closeStructuredLogsSync({ endedAt: now(), exitCode }));
  return manifest;
};

/**
 * Changes the lowest recorded level for the rest of the run. Before the files
 * open it applies to the buffered early lines too, so a user who enabled debug
 * logs also keeps the startup debug lines.
 */
export const setStructuredLogLevel = (level: LogLevel) => {
  if (state) state.minRank = LOG_LEVEL_RANK[level];
  else pendingMinLevel = level;
};

export const flushStructuredLogs = async () => {
  if (!state) return;
  await Promise.all(Object.values(state.writers).map((writer) => writer.flush()));
};

/**
 * Exit hook: flush what is queued and stamp `endedAt` with the exit code, so a
 * manifest without `endedAt` means a kill or hard crash and a non-zero
 * `exitCode` means the process exited on an error (an uncaught exception exits
 * through the same `exit` event). Runs on `quit` and again on `exit`; the last
 * call wins.
 */
export const closeStructuredLogsSync = ({
  endedAt = new Date(),
  exitCode,
}: { endedAt?: Date; exitCode?: number } = {}) => {
  if (!state) return;
  for (const writer of Object.values(state.writers)) writer.flushSync();
  try {
    writeFileSync(
      state.manifestPath,
      `${JSON.stringify(
        {
          ...state.manifest,
          endedAt: endedAt.toISOString(),
          ...(exitCode === undefined ? undefined : { exitCode }),
        },
        null,
        2,
      )}\n`,
    );
  } catch {
    // Nothing left to report to at exit.
  }
};

/** Test-only: forget the open files and the early buffer. */
export const resetStructuredLogsForTest = () => {
  state = undefined;
  earlyEntries = [];
  pendingMinLevel = undefined;
};
