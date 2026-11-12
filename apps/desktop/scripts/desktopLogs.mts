/**
 * Query and follow the structured Desktop logs that the main process writes to
 * `<userData>/logs/{main,renderer}.jsonl` (`src/main/utils/structuredLog/`).
 *
 *   node scripts/desktopLogs.mts list
 *   node scripts/desktopLogs.mts query [filters] [--limit 200] [--json]
 *   node scripts/desktopLogs.mts follow [filters] [--tail 20] [--json] [--duration 30s]
 *
 * Filters: --process main|renderer, --level debug|info|warn|error (lowest kept),
 * --since 10m|2h|1d|<ISO>, --until <same>, --ns <text>, --grep <text>,
 * --operation <op_…>, --topic <tpc_…>, --pid <n>.
 * Target: --profile <userData dir> | --dir <logs dir>; otherwise the profile
 * whose logs changed last among the packaged app, the default dev profile and
 * the checkout's managed profiles (`.cache/desktop-user-data*`).
 *
 * Only `node:` built-ins and erasable TypeScript, so it runs under plain `node`
 * even when the app itself does not start.
 */
import { createReadStream } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// ─── Layout (pinned to src/main/utils/structuredLog/layout.ts by the test) ───

export const LOG_DIRECTORY_NAME = 'logs';
export const LOG_MANIFEST_FILE = 'manifest.json';
export const LOG_PROCESSES = ['main', 'renderer'] as const;
export const LOG_LEVEL_RANK: Record<string, number> = { debug: 10, error: 40, info: 20, warn: 30 };
export const MAX_LOG_GENERATIONS = 3;
export const getLogFileName = (process: string) => `${process}.jsonl`;

type LogProcess = (typeof LOG_PROCESSES)[number];

export interface LogRecord {
  args?: unknown[];
  level: string;
  msg: string;
  ns?: string;
  operationId?: string;
  pid: number;
  process: LogProcess;
  source?: string;
  topicId?: string;
  ts: string;
}

interface LogManifest {
  appVersion?: string;
  endedAt?: string;
  exitCode?: number;
  isPackaged: boolean;
  pid: number;
  startedAt: string;
  userData: string;
}

// ─── Filters ─────────────────────────────────────────────────────────

export interface LogFilter {
  grep?: string;
  minLevel?: string;
  ns?: string;
  operationId?: string;
  pid?: number;
  processes: readonly LogProcess[];
  since?: number;
  topicId?: string;
  until?: number;
}

const DURATION_UNITS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };

/** `10m` → ten minutes before `now`; anything else must parse as a date. */
export const parseTimeBound = (value: string, now = Date.now()): number => {
  const relative = /^(\d+(?:\.\d+)?)([dhms])$/.exec(value.trim());
  if (relative) return now - Number(relative[1]) * DURATION_UNITS[relative[2]];
  const absolute = Date.parse(value);
  if (Number.isNaN(absolute))
    throw new Error(`Invalid time: ${value} (use 10m, 2h, 1d or an ISO date)`);
  return absolute;
};

export const parseDuration = (value: string): number => {
  const match = /^(\d+(?:\.\d+)?)([dhms])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value} (use 30s, 5m)`);
  return Number(match[1]) * DURATION_UNITS[match[2]];
};

/** The id fields hold the first id of a record; a substring check also finds the others. */
const mentions = (record: LogRecord, line: string, field: 'operationId' | 'topicId', id: string) =>
  record[field] === id || line.includes(id);

export const matchesFilter = (record: LogRecord, line: string, filter: LogFilter): boolean => {
  if (!filter.processes.includes(record.process)) return false;
  if (filter.minLevel && (LOG_LEVEL_RANK[record.level] ?? 0) < LOG_LEVEL_RANK[filter.minLevel])
    return false;
  if (filter.pid !== undefined && record.pid !== filter.pid) return false;
  if (filter.since !== undefined || filter.until !== undefined) {
    const time = Date.parse(record.ts);
    if (filter.since !== undefined && time < filter.since) return false;
    if (filter.until !== undefined && time > filter.until) return false;
  }
  if (filter.ns && !record.ns?.toLowerCase().includes(filter.ns.toLowerCase())) return false;
  if (filter.operationId && !mentions(record, line, 'operationId', filter.operationId))
    return false;
  if (filter.topicId && !mentions(record, line, 'topicId', filter.topicId)) return false;
  if (filter.grep && !line.toLowerCase().includes(filter.grep.toLowerCase())) return false;
  return true;
};

export const parseLine = (line: string): LogRecord | undefined => {
  if (!line.trim()) return undefined;
  try {
    const record = JSON.parse(line) as LogRecord;
    return typeof record.ts === 'string' && typeof record.msg === 'string' ? record : undefined;
  } catch {
    return undefined;
  }
};

// ─── Profiles ────────────────────────────────────────────────────────

const getAppDataDirectory = () => {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (process.platform === 'win32')
    return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
};

/** Profiles a managed dev runtime keeps per checkout and backend, under the checkout's `.cache/`. */
const MANAGED_PROFILE_NAMES = ['desktop-user-data', 'desktop-user-data-online'];

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

/** Every profile on this machine that has structured logs. */
export const discoverLogDirectories = async (cwd = process.cwd()): Promise<string[]> => {
  const candidates = new Set<string>();
  if (process.env.LOBE_DESKTOP_USER_DATA_DIR) {
    candidates.add(path.join(process.env.LOBE_DESKTOP_USER_DATA_DIR, LOG_DIRECTORY_NAME));
  }
  const appData = getAppDataDirectory();
  const entries = await readdir(appData).catch(() => [] as string[]);
  for (const entry of entries) {
    if (/^lobehub/i.test(entry)) candidates.add(path.join(appData, entry, LOG_DIRECTORY_NAME));
  }
  for (let directory = path.resolve(cwd); ; directory = path.dirname(directory)) {
    for (const name of MANAGED_PROFILE_NAMES) {
      candidates.add(path.join(directory, '.cache', name, LOG_DIRECTORY_NAME));
    }
    if (path.dirname(directory) === directory) break;
  }

  const found: string[] = [];
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, LOG_MANIFEST_FILE))) found.push(candidate);
  }
  return found;
};

const readManifest = async (directory: string): Promise<LogManifest | undefined> => {
  try {
    return JSON.parse(await readFile(path.join(directory, LOG_MANIFEST_FILE), 'utf8'));
  } catch {
    return undefined;
  }
};

const lastWriteTime = async (directory: string) => {
  let latest = 0;
  for (const process of LOG_PROCESSES) {
    const stats = await stat(path.join(directory, getLogFileName(process))).catch(() => undefined);
    if (stats) latest = Math.max(latest, stats.mtimeMs);
  }
  if (!latest) latest = (await stat(path.join(directory, LOG_MANIFEST_FILE))).mtimeMs;
  return latest;
};

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const describeRun = (manifest: LogManifest | undefined, alive: (pid: number) => boolean) => {
  if (!manifest) return 'no manifest';
  if (manifest.endedAt)
    return manifest.exitCode
      ? `crashed (exit code ${manifest.exitCode}) ${manifest.endedAt}`
      : `exited ${manifest.endedAt}`;
  return alive(manifest.pid)
    ? `running (pid ${manifest.pid})`
    : `crashed or killed (pid ${manifest.pid})`;
};

const resolveLogDirectory = async (values: { dir?: string; profile?: string }) => {
  if (values.dir) return path.resolve(values.dir);
  if (values.profile) return path.join(path.resolve(values.profile), LOG_DIRECTORY_NAME);
  const found = await discoverLogDirectories();
  if (found.length === 0) {
    throw new Error(
      'No Desktop structured logs found. Start the app once, or pass --profile <userData> / --dir <logs dir>.',
    );
  }
  const times = await Promise.all(found.map(lastWriteTime));
  return found[times.indexOf(Math.max(...times))];
};

// ─── Reading ─────────────────────────────────────────────────────────

/** Oldest first: `main.jsonl.3` … `main.jsonl.1`, then the live file. */
export const getGenerationPaths = (directory: string, process: LogProcess) => {
  const live = path.join(directory, getLogFileName(process));
  const rotated = Array.from(
    { length: MAX_LOG_GENERATIONS },
    (_, index) => `${live}.${MAX_LOG_GENERATIONS - index}`,
  );
  return [...rotated, live];
};

interface Match {
  line: string;
  record: LogRecord;
}

/**
 * Last `limit` matches across processes and rotated files, oldest first. With
 * `cursors` (from `createFollowCursors`), each live file is read only up to its
 * cursor, so `follow` resumes exactly where this tail ends.
 */
export const queryLogs = async (
  directory: string,
  filter: LogFilter,
  limit: number,
  cursors?: Map<string, Cursor>,
): Promise<Match[]> => {
  const matches: Match[] = [];
  for (const process of filter.processes) {
    const kept: Match[] = [];
    for (const file of getGenerationPaths(directory, process)) {
      const stats = await stat(file).catch(() => undefined);
      if (!stats) continue;
      const cursor = cursors?.get(file);
      // A rotation since the cursor was taken means this live file is all new: follow reads it.
      if (cursor && (cursor.ino !== stats.ino || cursor.offset === 0)) continue;
      const input = createReadStream(file, cursor ? { end: cursor.offset - 1 } : undefined);
      const lines = createInterface({ crlfDelay: Infinity, input });
      for await (const line of lines) {
        const record = parseLine(line);
        if (!record || !matchesFilter(record, line, filter)) continue;
        kept.push({ line, record });
        if (kept.length > limit) kept.shift();
      }
    }
    matches.push(...kept);
  }
  // Stable sort keeps each file's order for records written in the same millisecond.
  matches.sort((a, b) => a.record.ts.localeCompare(b.record.ts));
  return matches.slice(-limit);
};

const LEVEL_LABEL: Record<string, string> = {
  debug: 'DEBUG',
  error: 'ERROR',
  info: 'INFO ',
  warn: 'WARN ',
};

export const formatRecord = (record: LogRecord) => {
  const time = record.ts.slice(11, 23);
  const ns = record.ns ? ` [${record.ns}]` : '';
  const args = record.args?.length ? ` ${JSON.stringify(record.args)}` : '';
  const source = record.source ? ` (${record.source})` : '';
  return `${time} ${LEVEL_LABEL[record.level] ?? record.level} ${record.process.padEnd(8)}${ns} ${record.msg}${args}${source}`;
};

// ─── Follow ──────────────────────────────────────────────────────────

interface Cursor {
  ino?: number;
  offset: number;
  remainder: string;
}

const readBytes = async (file: string, start: number, end: number) => {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, end - start, start);
    return buffer;
  } finally {
    await handle.close();
  }
};

const readRange = async (file: string, start: number, end: number) =>
  (await readBytes(file, start, end)).toString('utf8');

/** How far back `createFollowCursors` looks for a line boundary; records are capped well below it. */
const FOLLOW_ALIGN_BYTES = 256 * 1024;

/**
 * Reads what a live file gained since `cursor`. A new inode means the writer
 * rotated it: the unread tail of the old file (now `.1`) comes first, then the
 * new file from its start.
 */
export const readAppended = async (file: string, cursor: Cursor): Promise<string[]> => {
  const stats = await stat(file).catch(() => undefined);
  if (!stats) return [];
  let text = cursor.remainder;
  if (stats.ino !== cursor.ino || stats.size < cursor.offset) {
    if (cursor.ino !== undefined) {
      const rotated = await stat(`${file}.1`).catch(() => undefined);
      if (rotated && rotated.ino === cursor.ino && rotated.size > cursor.offset) {
        text += await readRange(`${file}.1`, cursor.offset, rotated.size);
      }
      cursor.offset = 0;
    }
    cursor.ino = stats.ino;
  }
  if (stats.size > cursor.offset) {
    text += await readRange(file, cursor.offset, stats.size);
    cursor.offset = stats.size;
  }
  const lines = text.split('\n');
  cursor.remainder = lines.pop() ?? '';
  return lines;
};

/**
 * Marks the current end of each live file, backed up to the last complete line
 * so a record mid-append is read whole by `follow` rather than split in two.
 * Taken before the initial tail so lines written during it are not skipped.
 */
export const createFollowCursors = async (directory: string, filter: LogFilter) => {
  const cursors = new Map<string, Cursor>();
  for (const process of filter.processes) {
    const file = path.join(directory, getLogFileName(process));
    const stats = await stat(file).catch(() => undefined);
    let offset = stats?.size ?? 0;
    if (offset > 0) {
      const start = Math.max(0, offset - FOLLOW_ALIGN_BYTES);
      const lastNewline = (await readBytes(file, start, offset)).lastIndexOf(0x0a);
      offset = lastNewline === -1 ? start : start + lastNewline + 1;
    }
    cursors.set(file, { ino: stats?.ino, offset, remainder: '' });
  }
  return cursors;
};

const FOLLOW_POLL_MS = 500;

const follow = async (
  cursors: Map<string, Cursor>,
  filter: LogFilter,
  print: (match: Match) => void,
  durationMs?: number,
) => {
  const deadline = durationMs === undefined ? undefined : Date.now() + durationMs;
  while (deadline === undefined || Date.now() < deadline) {
    const batch: Match[] = [];
    for (const [file, cursor] of cursors) {
      for (const line of await readAppended(file, cursor)) {
        const record = parseLine(line);
        if (record && matchesFilter(record, line, filter)) batch.push({ line, record });
      }
    }
    batch.sort((a, b) => a.record.ts.localeCompare(b.record.ts));
    batch.forEach(print);
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_POLL_MS));
  }
};

// ─── CLI ─────────────────────────────────────────────────────────────

const USAGE = `Usage: desktopLogs <list|query|follow> [options]

  list                     Profiles with structured logs, newest first
  query                    Print matching records (oldest first)
  follow                   Print matching records as they are written

Filters:  --process main|renderer   --level debug|info|warn|error
          --since 10m|ISO  --until 10m|ISO  --ns TEXT  --grep TEXT
          --operation op_…  --topic tpc_…  --pid N
Target:   --profile USER_DATA_DIR | --dir LOGS_DIR
Output:   --json  --limit N (query, default 200)  --tail N (follow, default 20)
          --duration 30s (follow: stop after this long)`;

const toFilter = (values: Record<string, string | boolean | undefined>): LogFilter => {
  const processes = values.process
    ? String(values.process)
        .split(',')
        .map((item) => item.trim())
    : [...LOG_PROCESSES];
  for (const item of processes) {
    if (!LOG_PROCESSES.includes(item as LogProcess)) throw new Error(`Unknown --process ${item}`);
  }
  if (values.level && !(String(values.level) in LOG_LEVEL_RANK)) {
    throw new Error(`Unknown --level ${String(values.level)}`);
  }
  const string = (key: string) => (values[key] === undefined ? undefined : String(values[key]));
  return {
    grep: string('grep'),
    minLevel: string('level'),
    ns: string('ns'),
    operationId: string('operation'),
    pid: values.pid === undefined ? undefined : Number(values.pid),
    processes: processes as LogProcess[],
    since: values.since === undefined ? undefined : parseTimeBound(String(values.since)),
    topicId: string('topic'),
    until: values.until === undefined ? undefined : parseTimeBound(String(values.until)),
  };
};

const main = async (argv: string[]) => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      dir: { type: 'string' },
      duration: { type: 'string' },
      grep: { type: 'string' },
      help: { short: 'h', type: 'boolean' },
      json: { type: 'boolean' },
      level: { type: 'string' },
      limit: { type: 'string' },
      ns: { type: 'string' },
      operation: { type: 'string' },
      pid: { type: 'string' },
      process: { type: 'string' },
      profile: { type: 'string' },
      since: { type: 'string' },
      tail: { type: 'string' },
      topic: { type: 'string' },
      until: { type: 'string' },
    },
  });
  const [command] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }

  if (command === 'list') {
    const found = await discoverLogDirectories();
    const rows = await Promise.all(
      found.map(async (directory) => ({
        directory,
        lastWrite: await lastWriteTime(directory),
        manifest: await readManifest(directory),
      })),
    );
    rows.sort((a, b) => b.lastWrite - a.lastWrite);
    if (values.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) console.log('No Desktop structured logs found.');
    for (const { directory, lastWrite, manifest } of rows) {
      const version = manifest?.appVersion ? ` v${manifest.appVersion}` : '';
      const kind = manifest?.isPackaged ? 'packaged' : 'dev';
      console.log(
        `${directory}\n  ${kind}${version}, ${describeRun(manifest, isAlive)}, last write ${new Date(lastWrite).toISOString()}`,
      );
    }
    return;
  }

  if (command !== 'query' && command !== 'follow')
    throw new Error(`Unknown command: ${command}\n\n${USAGE}`);

  const directory = await resolveLogDirectory(values);
  const filter = toFilter(values);
  const print = ({ line, record }: Match) => console.log(values.json ? line : formatRecord(record));
  console.error(`# ${directory}`);

  if (command === 'query') {
    const limit = values.limit ? Number(values.limit) : 200;
    const matches = await queryLogs(directory, filter, limit);
    matches.forEach(print);
    if (filter.operationId && matches.length > 0) {
      console.error(
        `# Server side of this operation: the agent-tracing skill with ${filter.operationId}`,
      );
    }
    return;
  }

  const tail = values.tail ? Number(values.tail) : 20;
  const cursors = await createFollowCursors(directory, filter);
  if (tail > 0) (await queryLogs(directory, filter, tail, cursors)).forEach(print);
  await follow(
    cursors,
    filter,
    print,
    values.duration ? parseDuration(values.duration) : undefined,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
