import { describe, expect, it } from 'vitest';

import { MAX_PACKAGE_FILES, namesObjectBuiltIn, packageFilesSchema } from './packageFiles';

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

describe('namesObjectBuiltIn', () => {
  it('looks at whole segments', () => {
    expect(namesObjectBuiltIn('a/prototype/b')).toBe(true);
    expect(namesObjectBuiltIn('a/prototypes.md')).toBe(false);
  });
});
