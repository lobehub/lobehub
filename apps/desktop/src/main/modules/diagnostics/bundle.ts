import { access, type FileHandle, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import type { DiagnosticsBundleResult } from '@lobechat/electron-client-ipc';
import { strToU8, zip, type Zippable } from 'fflate';

import {
  getLogFileName,
  LOG_MANIFEST_FILE,
  LOG_PROCESSES,
  MAX_LOG_GENERATIONS,
} from '@/utils/structuredLog/layout';

/** Log lines older than this stay out of the bundle; one day covers "it broke earlier today". */
export const DIAGNOSTICS_LOG_WINDOW_MS = 24 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

/** `LobeHub-diagnostics-20261113-153012.zip`, in local time so it matches the user's clock. */
export const getDiagnosticsFileName = (now: Date) =>
  `LobeHub-diagnostics-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;

const exists = async (filePath: string) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const SNAPSHOT_ATTEMPTS = 5;
const SNAPSHOT_RETRY_MS = 20;

type OpenFile = (filePath: string) => Promise<FileHandle>;

const openOrSkip = (openFile: OpenFile, filePath: string) =>
  openFile(filePath).catch(() => undefined);

/** Every opened handle still is the file at its path, and no missing path has appeared. */
const isConsistentSnapshot = async (paths: string[], handles: (FileHandle | undefined)[]) => {
  const [opened, current] = await Promise.all([
    Promise.all(handles.map((handle) => handle?.stat().then(({ ino }) => ino))),
    Promise.all(
      paths.map((filePath) =>
        stat(filePath).then(
          ({ ino }) => ino,
          () => undefined,
        ),
      ),
    ),
  ]);
  return opened.every((ino, index) => ino === current[index]);
};

const closeAll = (handles: (FileHandle | undefined)[]) =>
  Promise.all(handles.map((handle) => handle?.close().catch(() => undefined)));

/**
 * Opens a process's log files, oldest first: `main.jsonl.3` … `main.jsonl.1`, then
 * `main.jsonl`, as one snapshot. The writer may rotate (rename every generation up by
 * one) at any moment; an open handle keeps reading the file it was opened on, so once
 * all are open no generation can be skipped or read twice. A rotation that lands
 * between the opens is detected by comparing each handle with its path, and the
 * snapshot is retaken.
 */
export const openGenerations = async (
  logDirectory: string,
  fileName: string,
  openFile: OpenFile = (filePath) => open(filePath, 'r'),
) => {
  const paths = [
    ...Array.from({ length: MAX_LOG_GENERATIONS }, (_, index) =>
      path.join(logDirectory, `${fileName}.${MAX_LOG_GENERATIONS - index}`),
    ),
    path.join(logDirectory, fileName),
  ];

  let handles: (FileHandle | undefined)[] = [];
  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
    handles = [];
    for (const filePath of paths) handles.push(await openOrSkip(openFile, filePath));
    if (attempt === SNAPSHOT_ATTEMPTS || (await isConsistentSnapshot(paths, handles))) break;
    await closeAll(handles);
    await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_RETRY_MS));
  }
  // After the last attempt the snapshot is kept as is: a bundle with a possible gap
  // during sustained rotation is more useful than no bundle.
  return handles.filter((handle): handle is FileHandle => handle !== undefined);
};

const readTimestamp = (line: string) => {
  // Records start with `{"…","ts":"…"}`; parsing is the only reliable read of `ts`.
  try {
    const ts = (JSON.parse(line) as { ts?: unknown }).ts;
    return typeof ts === 'string' ? Date.parse(ts) : Number.NaN;
  } catch {
    return Number.NaN;
  }
};

/**
 * Concatenates a process's JSONL records written at or after `since`, oldest first.
 * A line without a readable timestamp (a torn write at a crash) is kept: it is
 * usually the most interesting one.
 */
export const collectRecentLogLines = async (handles: FileHandle[], since: number) => {
  const lines: string[] = [];
  try {
    for (const handle of handles) {
      const reader = createInterface({
        crlfDelay: Infinity,
        input: handle.createReadStream({ encoding: 'utf8' }),
      });
      for await (const line of reader) {
        if (!line) continue;
        const ts = readTimestamp(line);
        if (Number.isNaN(ts) || ts >= since) lines.push(line);
      }
    }
  } finally {
    // Streams close their handle when they end; this closes the ones a failure left unread.
    await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)));
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};

const zipAsync = (files: Zippable) =>
  new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data)));
  });

export interface BuildDiagnosticsBundleOptions {
  logDirectory: string;
  now?: Date;
  /** Written as `system.json`: app version, OS and settings that matter for a report. */
  systemInfo: Record<string, unknown>;
  windowMs?: number;
}

/**
 * Zips the last day of `main.jsonl` / `renderer.jsonl` (across rotated files), the
 * current `manifest.json` and `system.json`. Records are already secret-redacted
 * when written (`structuredLog/record.ts`).
 */
export const buildDiagnosticsBundle = async ({
  logDirectory,
  now = new Date(),
  systemInfo,
  windowMs = DIAGNOSTICS_LOG_WINDOW_MS,
}: BuildDiagnosticsBundleOptions) => {
  const since = now.getTime() - windowMs;
  const files: Zippable = {
    'system.json': strToU8(
      `${JSON.stringify(
        { ...systemInfo, exportedAt: now.toISOString(), logsSince: new Date(since).toISOString() },
        null,
        2,
      )}\n`,
    ),
  };

  const manifestPath = path.join(logDirectory, LOG_MANIFEST_FILE);
  if (await exists(manifestPath)) files[LOG_MANIFEST_FILE] = await readFile(manifestPath);

  for (const process of LOG_PROCESSES) {
    const fileName = getLogFileName(process);
    const content = await collectRecentLogLines(
      await openGenerations(logDirectory, fileName),
      since,
    );
    if (content) files[fileName] = strToU8(content);
  }

  return zipAsync(files);
};

export interface WriteDiagnosticsBundleOptions extends BuildDiagnosticsBundleOptions {
  outputDirectory: string;
}

export const writeDiagnosticsBundle = async ({
  outputDirectory,
  ...options
}: WriteDiagnosticsBundleOptions): Promise<DiagnosticsBundleResult> => {
  const now = options.now ?? new Date();
  const data = await buildDiagnosticsBundle({ ...options, now });
  const fileName = getDiagnosticsFileName(now);
  const filePath = path.join(outputDirectory, fileName);
  await writeFile(filePath, data);
  return { fileName, filePath, size: (await stat(filePath)).size };
};
