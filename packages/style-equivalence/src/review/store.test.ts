import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readReviews, reviewPath, writeReviews } from './store';

let records: string;

beforeEach(async () => {
  records = await mkdtemp(path.join(tmpdir(), 'se-reviews-'));
});

afterEach(async () => {
  await rm(records, { force: true, recursive: true });
});

const pass = (key: string, hash = 'h1') => ({
  hash,
  key,
  note: '复查通过',
  reason: 'REVIEW_PASS',
  reasons: ['PLACEMENT_SUBSTITUTED'],
  signedAt: '2026-11-05T00:00:00Z',
  signer: 'innei',
});

const rework = (key: string) => ({
  at: '2026-11-05T00:00:00Z',
  base: 'aaa',
  elementSignature: 'span|styles.dot',
  file: 'src/A.tsx',
  hash: 'h1',
  head: 'bbb',
  key,
  note: '在线时多了灰边',
  reviewer: 'innei',
  runId: 'run-1',
});

const note = (key: string) => ({
  at: '2026-11-05T00:00:00Z',
  finding: 'className 落在根 svg 上',
  hash: 'h1',
  key,
  suggestion: 'pass' as const,
});

describe('review store', () => {
  it('stores passes, reworks and agent notes under the records directory', async () => {
    await writeReviews(records, 'src/A.tsx', {
      notes: [note('src/A.tsx|A#1')],
      passes: [pass('src/A.tsx|A#0')],
      reworks: [rework('src/A.tsx|A#2')],
    });
    const stored = JSON.parse(await readFile(reviewPath(records, 'src/A.tsx'), 'utf8'));
    expect(reviewPath(records, 'src/A.tsx')).toBe(path.join(records, 'reviews', 'src/A.tsx.json'));
    expect(stored.passes).toHaveLength(1);
    const reviews = await readReviews(records, ['src/A.tsx', 'src/A.tsx']);
    expect(reviews.passes.get('src/A.tsx|A#0')?.note).toBe('复查通过');
    expect(reviews.reworks.get('src/A.tsx|A#2')?.note).toBe('在线时多了灰边');
    expect(reviews.notes.get('src/A.tsx|A#1')?.suggestion).toBe('pass');
  });

  it('merges later writes by key instead of overwriting the file', async () => {
    await writeReviews(records, 'src/A.tsx', { passes: [pass('src/A.tsx|A#0')] });
    await writeReviews(records, 'src/A.tsx', { reworks: [rework('src/A.tsx|A#2')] });
    await writeReviews(records, 'src/A.tsx', { passes: [pass('src/A.tsx|A#0', 'h2')] });
    const reviews = await readReviews(records, ['src/A.tsx']);
    expect(reviews.passes.get('src/A.tsx|A#0')?.hash).toBe('h2');
    expect(reviews.reworks.size).toBe(1);
  });

  it('keeps every record when writes to one file run concurrently', async () => {
    await Promise.all(
      ['A#0', 'A#1', 'A#2', 'A#3'].map((id) =>
        writeReviews(records, 'src/A.tsx', { passes: [pass(`src/A.tsx|${id}`)] }),
      ),
    );
    expect((await readReviews(records, ['src/A.tsx'])).passes.size).toBe(4);
  });

  it('keeps passes for different hashes and picks the one matching the current hash', async () => {
    await writeReviews(records, 'src/A.tsx', { passes: [pass('src/A.tsx|A#0', 'h1')] });
    await writeReviews(records, 'src/A.tsx', { passes: [pass('src/A.tsx|A#0', 'h2')] });
    const scoped = await readReviews(records, ['src/A.tsx'], {
      hashes: new Map([['src/A.tsx|A#0', 'h1']]),
    });
    expect(scoped.passes.get('src/A.tsx|A#0')?.hash).toBe('h1');
  });

  it('only reads reworks of the requested PR', async () => {
    await writeReviews(records, 'src/A.tsx', { reworks: [{ ...rework('src/A.tsx|A#2'), pr: 1 }] });
    await writeReviews(records, 'src/A.tsx', {
      reworks: [{ ...rework('src/A.tsx|A#2'), note: 'PR 2 的原因', pr: 2 }],
    });
    const scoped = await readReviews(records, ['src/A.tsx'], { pr: 1 });
    expect(scoped.reworks.get('src/A.tsx|A#2')?.pr).toBe(1);
    expect((await readReviews(records, ['src/A.tsx'], { pr: 3 })).reworks.size).toBe(0);
  });

  it('reads an unknown file as empty', async () => {
    const reviews = await readReviews(records, ['src/missing.tsx']);
    expect(reviews.passes.size + reviews.reworks.size + reviews.notes.size).toBe(0);
  });
});
