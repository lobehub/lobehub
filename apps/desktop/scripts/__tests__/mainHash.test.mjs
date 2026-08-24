import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeMainHash, STANDALONE_FILES } from '../mainHash.mjs';

const desktopRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const repoRoot = path.dirname(path.dirname(desktopRoot));

describe('mainHash', () => {
  it('only hashes git-tracked standalone files so CI fresh checkouts reproduce the hash', () => {
    for (const file of STANDALONE_FILES) {
      const abs = path.join(desktopRoot, file);
      expect(
        () => execFileSync('git', ['ls-files', '--error-unmatch', abs], { cwd: repoRoot }),
        `${file} must be committed — untracked inputs are silently skipped on fresh checkouts`,
      ).not.toThrow();
    }
  });

  it('changes when a file under src/common changes', () => {
    const probe = path.join(desktopRoot, 'src', 'common', `__mainhash-probe-${randomUUID()}.ts`);
    const before = computeMainHash();
    writeFileSync(probe, 'export const probe = 1;\n');
    try {
      expect(computeMainHash()).not.toBe(before);
    } finally {
      rmSync(probe, { force: true });
    }
  });
});
