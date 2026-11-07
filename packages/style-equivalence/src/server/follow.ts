import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadRun, type StoredRun } from './api';

const RUN_NAME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-([\da-f]+)-([\da-f]+)(?:-(\d+))?$/;

export interface RunName {
  base: string;
  head: string;
  name: string;
  order: number;
  startedAt: string;
}

export const parseRunName = (name: string): RunName | undefined => {
  const match = RUN_NAME.exec(name);
  if (!match) return undefined;
  const [, day, hours, minutes, seconds, millis, base, head, suffix] = match;
  const startedAt = `${day}T${hours}:${minutes}:${seconds}.${millis}Z`;
  const time = Date.parse(startedAt);
  if (Number.isNaN(time)) return undefined;
  return { base, head, name, order: time * 1000 + Number(suffix ?? 0), startedAt };
};

const isComplete = (recordsDir: string, name: string) =>
  existsSync(path.join(recordsDir, name, 'results.json'));

const prOf = async (recordsDir: string, name: string) => {
  try {
    const run = JSON.parse(await readFile(path.join(recordsDir, name, 'run.json'), 'utf8'));
    return (run.pr as { number?: number } | undefined)?.number;
  } catch {
    return undefined;
  }
};

export const newestRun = async (recordsDir: string, anchor: string, pr?: number) => {
  const pinned = parseRunName(anchor);
  if (!pinned) return anchor;
  const entries = await readdir(recordsDir, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseRunName(entry.name))
    .filter((run): run is RunName => !!run && run.base === pinned.base && run.order > pinned.order)
    .sort((left, right) => right.order - left.order);
  for (const run of candidates) {
    if (!isComplete(recordsDir, run.name)) continue;
    if (pr === undefined || (await prOf(recordsDir, run.name)) === pr) return run.name;
  }
  return anchor;
};

export interface FollowInfo {
  base: string;
  head: string;
  pinned: boolean;
  requested: string;
  runId: string;
  startedAt?: string;
}

export const createRunSource = async ({
  pin = false,
  recordsDir,
  runDir,
}: {
  pin?: boolean;
  recordsDir: string;
  runDir: string;
}) => {
  const anchor = path.basename(runDir);
  let loaded = { dir: runDir, stored: await loadRun(runDir) };
  const pr = (loaded.stored.run.pr as { number?: number } | undefined)?.number;
  let pending: Promise<typeof loaded> | undefined;
  const refresh = async () => {
    const name = await newestRun(recordsDir, anchor, pr);
    const dir = name === anchor ? runDir : path.join(recordsDir, name);
    if (dir === loaded.dir) return loaded;
    try {
      loaded = { dir, stored: await loadRun(dir) };
    } catch {
      return loaded;
    }
    return loaded;
  };
  const current = async (): Promise<{ dir: string; stored: StoredRun }> => {
    if (pin) return loaded;
    pending ??= refresh().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const info = (stored: StoredRun, dir: string): FollowInfo => ({
    base: String(stored.run.base ?? ''),
    head: String(stored.run.head ?? ''),
    pinned: pin,
    requested: anchor,
    runId: path.basename(dir),
    startedAt: parseRunName(path.basename(dir))?.startedAt,
  });
  return { current, info };
};
