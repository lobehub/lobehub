import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SignoffRecord } from '../signoff/store';

export const REVIEWS_DIR = 'reviews';

export interface ReworkRecord {
  at: string;
  base: string;
  elementSignature: string;
  file: string;
  hash: string;
  head: string;
  key: string;
  note: string;
  pr?: number;
  resolvedAt?: string;
  reviewer: string;
  runId: string;
}

export interface AgentNote {
  at: string;
  finding: string;
  hash: string;
  key: string;
  suggestion: 'pass' | 'rework';
}

export interface ReviewFile {
  notes: AgentNote[];
  passes: SignoffRecord[];
  reworks: ReworkRecord[];
}

export interface Reviews {
  notes: Map<string, AgentNote>;
  passes: Map<string, SignoffRecord>;
  reworks: Map<string, ReworkRecord>;
}

export const reviewPath = (recordsDir: string, file: string) =>
  path.join(recordsDir, REVIEWS_DIR, `${file}.json`);

const readReviewFile = async (recordsDir: string, file: string): Promise<ReviewFile> => {
  try {
    const parsed = JSON.parse(await readFile(reviewPath(recordsDir, file), 'utf8'));
    return {
      notes: parsed.notes ?? [],
      passes: parsed.passes ?? [],
      reworks: parsed.reworks ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { notes: [], passes: [], reworks: [] };
    throw error;
  }
};

export const readReviews = async (recordsDir: string, files: string[]): Promise<Reviews> => {
  const reviews: Reviews = { notes: new Map(), passes: new Map(), reworks: new Map() };
  for (const file of new Set(files)) {
    const stored = await readReviewFile(recordsDir, file);
    for (const record of stored.passes) reviews.passes.set(record.key, record);
    for (const record of stored.reworks) reviews.reworks.set(record.key, record);
    for (const record of stored.notes) reviews.notes.set(record.key, record);
  }
  return reviews;
};

const mergeByKey = <T extends { key: string }>(current: T[], next: T[] = []) => {
  const merged = new Map(current.map((record) => [record.key, record]));
  for (const record of next) merged.set(record.key, record);
  return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
};

const queues = new Map<string, Promise<unknown>>();

const writeNow = async (recordsDir: string, file: string, patch: Partial<ReviewFile>) => {
  const current = await readReviewFile(recordsDir, file);
  const next: ReviewFile = {
    notes: mergeByKey(current.notes, patch.notes),
    passes: mergeByKey(current.passes, patch.passes),
    reworks: mergeByKey(current.reworks, patch.reworks),
  };
  const target = reviewPath(recordsDir, file);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
  await rename(temporary, target);
};

export const writeReviews = (recordsDir: string, file: string, patch: Partial<ReviewFile>) => {
  const target = reviewPath(recordsDir, file);
  const previous = queues.get(target) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeNow(recordsDir, file, patch));
  queues.set(target, next);
  return next;
};
