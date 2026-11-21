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

export interface ReviewScope {
  hashes?: Map<string, string>;
  pr?: number;
}

export const reviewScope = (items: Array<{ hash: string; key: string }>, pr?: number) => ({
  hashes: new Map(items.map((item) => [item.key, item.hash])),
  pr,
});

const matchesHash = (scope: ReviewScope | undefined, record: { hash: string; key: string }) => {
  const expected = scope?.hashes?.get(record.key);
  return expected === undefined || expected === record.hash;
};

export const readReviews = async (
  recordsDir: string,
  files: string[],
  scope?: ReviewScope,
): Promise<Reviews> => {
  const reviews: Reviews = { notes: new Map(), passes: new Map(), reworks: new Map() };
  for (const file of new Set(files)) {
    const stored = await readReviewFile(recordsDir, file);
    for (const record of stored.passes)
      if (matchesHash(scope, record)) reviews.passes.set(record.key, record);
    for (const record of stored.notes)
      if (matchesHash(scope, record)) reviews.notes.set(record.key, record);
    for (const record of stored.reworks)
      if (!scope || record.pr === scope.pr) reviews.reworks.set(record.key, record);
  }
  return reviews;
};

const hashId = (record: { hash: string; key: string }) => `${record.key}@${record.hash}`;
const reworkId = (record: ReworkRecord) => `${record.key}@${record.pr ?? record.runId}`;

const mergeById = <T>(current: T[], next: T[] = [], id: (record: T) => string) => {
  const merged = new Map(current.map((record) => [id(record), record]));
  for (const record of next) merged.set(id(record), record);
  return [...merged].sort(([a], [b]) => a.localeCompare(b)).map(([, record]) => record);
};

const queues = new Map<string, Promise<unknown>>();

const writeNow = async (recordsDir: string, file: string, patch: Partial<ReviewFile>) => {
  const current = await readReviewFile(recordsDir, file);
  const next: ReviewFile = {
    notes: mergeById(current.notes, patch.notes, hashId),
    passes: mergeById(current.passes, patch.passes, hashId),
    reworks: mergeById(current.reworks, patch.reworks, reworkId),
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
