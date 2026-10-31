// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupSourceSnapshots } from './cleanupSnapshots';

const owned: string[] = [];
const setup = async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'stylex-cleanup-test-'));
  owned.push(output);
  await mkdir(path.join(output, 'base-source/.stylex-dependencies'), { recursive: true });
  await writeFile(path.join(output, 'base-source/package.json'), '{"name":"source"}');
  await writeFile(path.join(output, 'base-source/component.ts'), 'export const x = 1;');
  await writeFile(path.join(output, 'base-source/.stylex-dependencies/pnpm-lock.yaml'), 'lock');
  await writeFile(path.join(output, 'snapshot.json.gz'), 'raw-evidence');
  return output;
};

afterEach(async () => {
  for (const output of owned.splice(0)) await rm(output, { force: true, recursive: true });
});

describe('owned verification source lifecycle', () => {
  it('removes partial exports, preserving lock inputs and browser evidence', async () => {
    const output = await setup();
    const result = await cleanupSourceSnapshots(output);
    expect(result.removed).toEqual(['base-source']);
    expect(await readFile(path.join(output, 'snapshot.json.gz'), 'utf8')).toBe('raw-evidence');
    expect(
      await readFile(path.join(output, 'source-metadata/base-source/package.json'), 'utf8'),
    ).toContain('source');
    expect(
      await readFile(
        path.join(output, 'source-metadata/base-source/.stylex-dependencies/pnpm-lock.yaml'),
        'utf8',
      ),
    ).toBe('lock');
    await expect(readFile(path.join(output, 'base-source/component.ts'))).rejects.toThrow();
    expect((await cleanupSourceSnapshots(output)).removed).toEqual([]);
  });

  it('refuses symlinked source directories without touching their targets', async () => {
    const output = await setup();
    await symlink(path.join(output, 'base-source'), path.join(output, 'candidate-source'));
    await expect(cleanupSourceSnapshots(output)).rejects.toThrow('REFUSE_SOURCE_CLEANUP_SYMLINK');
    expect(await readFile(path.join(output, 'base-source/component.ts'), 'utf8')).toContain(
      'export',
    );
  });
});
