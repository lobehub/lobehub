import { describe, expect, it } from 'vitest';

import {
  MAX_PACKAGE_FILES,
  mergePackageFiles,
  namesObjectBuiltIn,
  packageFilesSchema,
  packageSizeProblem,
} from './packageFiles';

const file = (path: string, content = 'x') => ({ content, path });

describe('packageFilesSchema', () => {
  it('takes references, templates and scripts by relative path', () => {
    expect(
      packageFilesSchema.parse([file('scripts/check-pr.sh'), file('references/replica-read.md')]),
    ).toHaveLength(2);
  });

  it('keeps every path inside the package and SKILL.md as the body', () => {
    for (const path of [
      '../secrets.txt',
      '/etc/passwd',
      'scripts/../../x',
      'SKILL.md',
      'a b.md',
      '__proto__',
      'scripts/constructor',
    ])
      expect(packageFilesSchema.safeParse([file(path)]).success).toBe(false);
  });

  it('refuses two files on one path, and a package too large to load', () => {
    expect(packageFilesSchema.safeParse([file('a.md'), file('a.md')]).success).toBe(false);
    expect(
      packageFilesSchema.safeParse(
        Array.from({ length: MAX_PACKAGE_FILES + 1 }, (_, i) => file(`f${i}.md`)),
      ).success,
    ).toBe(false);
    const big = 'x'.repeat(60_000);
    expect(
      packageFilesSchema.safeParse(Array.from({ length: 5 }, (_, i) => file(`f${i}.md`, big)))
        .success,
    ).toBe(false);
  });
});

describe('packageSizeProblem', () => {
  it('passes a merged package that still fits', () => {
    expect(packageSizeProblem([file('a.md'), file('b.md')])).toBeUndefined();
  });

  // A revision edits the package instead of replacing it, so what it adds lands
  // on top of the files it does not name.
  it('catches an edit that only overflows once merged', () => {
    const full = Array.from({ length: MAX_PACKAGE_FILES }, (_, i) => file(`f${i}.md`));
    expect(packageFilesSchema.safeParse([file('new.md')]).success).toBe(true);
    expect(packageSizeProblem([...full, file('new.md')])).toMatch(/at most 20 files/);
  });

  it('counts the characters of the whole package, not just the edit', () => {
    const each = 'x'.repeat(60_000);
    const merged = Array.from({ length: 5 }, (_, i) => file(`f${i}.md`, each));
    expect(packageSizeProblem(merged)).toMatch(/256000 characters/);
  });

  it('counts a binary file as a file', () => {
    const binaries = Array.from({ length: MAX_PACKAGE_FILES + 1 }, (_, i) => ({
      content: '',
      fileId: `file-${i}`,
      path: `assets/${i}.png`,
    }));
    expect(packageSizeProblem(binaries)).toMatch(/at most 20 files/);
  });
});

describe('mergePackageFiles', () => {
  it('keeps the files an edit does not name, and drops the ones it removes', () => {
    const merged = mergePackageFiles([file('a.md', 'a'), file('b.md', 'b')], {
      remove: ['a.md'],
      upsert: [file('b.md', 'B'), file('c.md', 'c')],
    });

    expect(merged.map((entry) => entry.path).sort()).toEqual(['b.md', 'c.md']);
    expect(merged.find((entry) => entry.path === 'b.md')?.content).toBe('B');
  });

  it('reports a package that only overflows once the edit is merged into it', () => {
    const each = 'x'.repeat(60_000);
    const existing = Array.from({ length: 4 }, (_, i) => file(`f${i}.md`, each));
    const small = mergePackageFiles(existing, { upsert: [file('new.md', 'y'.repeat(10_000))] });
    const tooBig = mergePackageFiles(existing, { upsert: [file('new.md', 'y'.repeat(20_000))] });

    // The edit alone fits either way; the package it lands in is what has to fit.
    expect(packageSizeProblem([file('new.md', 'y'.repeat(20_000))])).toBeUndefined();
    expect(packageSizeProblem(small)).toBeUndefined();
    expect(packageSizeProblem(tooBig)).toMatch(/256000 characters/);
  });
});

describe('namesObjectBuiltIn', () => {
  it('looks at whole segments', () => {
    expect(namesObjectBuiltIn('a/prototype/b')).toBe(true);
    expect(namesObjectBuiltIn('a/prototypes.md')).toBe(false);
  });
});
