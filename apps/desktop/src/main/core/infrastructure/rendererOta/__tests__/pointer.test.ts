import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { emptyPointer, readPointer, writePointer } from '../pointer';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

let dirs: string[] = [];
const makeDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'renderer-ota-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
  dirs = [];
});

describe('pointer', () => {
  it('round-trips through write/read', () => {
    const dir = makeDir();
    const pointer = {
      ...emptyPointer(HASH_A),
      current: 'r2',
      pendingBootCheck: true,
      previous: 'r1',
      staged: 'r3',
    };

    writePointer(dir, pointer);

    expect(readPointer(dir, HASH_A)).toEqual(pointer);
  });

  it('returns an empty pointer when the file is missing', () => {
    expect(readPointer(makeDir(), HASH_A)).toEqual(emptyPointer(HASH_A));
  });

  it('resets the lineage when mainHash changed (full release installed)', () => {
    const dir = makeDir();
    writePointer(dir, { ...emptyPointer(HASH_A), current: 'r5' });

    expect(readPointer(dir, HASH_B)).toEqual(emptyPointer(HASH_B));
  });

  it('survives a corrupt pointer file', () => {
    const dir = makeDir();
    writeFileSync(path.join(dir, 'pointer.json'), '{not json');

    expect(readPointer(dir, HASH_A)).toEqual(emptyPointer(HASH_A));
  });

  it('writes atomically via temp+rename', () => {
    const dir = makeDir();
    writePointer(dir, emptyPointer(HASH_A));

    const raw = JSON.parse(readFileSync(path.join(dir, 'pointer.json'), 'utf8'));
    expect(raw.mainHash).toBe(HASH_A);
  });
});
