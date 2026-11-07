// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const importTargets = async (directory: string) => {
  const filenames = (await readdir(path.join(__dirname, directory))).filter((name) =>
    name.endsWith('.ts'),
  );
  const sources = await Promise.all(
    filenames.map((filename) => readFile(path.join(__dirname, directory, filename), 'utf8')),
  );

  return sources.flatMap((source) =>
    [...source.matchAll(/(?:from\s|import\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  );
};

describe('PostgreSQL provider boundaries', () => {
  it.each([
    ['pgLike', 'pgSearch'],
    ['pgSearch', 'pgLike'],
  ])('%s does not depend on %s', async (provider, forbiddenProvider) => {
    const imports = await importTargets(provider);

    expect(imports.filter((target) => target.includes(`/${forbiddenProvider}`))).toEqual([]);
  });

  it('keeps the shared PostgreSQL layer provider-independent', async () => {
    const imports = await importTargets('postgres');

    expect(imports.filter((target) => /\/(?:pgLike|pgSearch)/.test(target))).toEqual([]);
  });
});
