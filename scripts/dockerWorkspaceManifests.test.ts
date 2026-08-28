import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(path.resolve(import.meta.dirname, '../Dockerfile'), 'utf8');

describe('Docker workspace manifests', () => {
  it('copies the Workbench package manifest before pnpm i', () => {
    const copyIdx = dockerfile.indexOf('COPY apps/workbench/package.json');
    const installIdx = dockerfile.indexOf('\n    pnpm i &&');

    expect(copyIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeLessThan(installIdx);
  });
});
