import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashBuildOutput, readOutputHash } from './workerOutputHash';

const makeBuild = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'worker-output-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
};

const baseline = {
  'client/assets/entry-abc.js': 'console.log(1)',
  'server/index.js': 'export default {}',
  'server/wrangler.json': '{"name":"lobehub-workbench"}',
};

describe('hashBuildOutput', () => {
  it('gives identical builds the same hash regardless of write order', () => {
    const reversed = Object.fromEntries(Object.entries(baseline).reverse());

    expect(hashBuildOutput(makeBuild(baseline))).toBe(hashBuildOutput(makeBuild(reversed)));
  });

  it('changes when any deployable file changes', () => {
    const changedWorkerConfig = { ...baseline, 'server/wrangler.json': '{"name":"other"}' };

    expect(hashBuildOutput(makeBuild(changedWorkerConfig))).not.toBe(
      hashBuildOutput(makeBuild(baseline)),
    );
  });

  it('changes when a file moves even though its bytes do not', () => {
    const dir = makeBuild(baseline);
    const before = hashBuildOutput(dir);
    renameSync(
      path.join(dir, 'client/assets/entry-abc.js'),
      path.join(dir, 'client/assets/entry-def.js'),
    );

    expect(hashBuildOutput(dir)).not.toBe(before);
  });
});

describe('readOutputHash', () => {
  it('treats a missing or empty record as no previous deploy', () => {
    const dir = makeBuild({ 'empty.txt': '\n', 'hash.txt': 'abc123\n' });

    expect(readOutputHash(undefined)).toBeUndefined();
    expect(readOutputHash(path.join(dir, 'missing.txt'))).toBeUndefined();
    expect(readOutputHash(path.join(dir, 'empty.txt'))).toBeUndefined();
    expect(readOutputHash(path.join(dir, 'hash.txt'))).toBe('abc123');
  });
});
