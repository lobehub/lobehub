import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach } from 'vitest';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

export const createFixture = async (files: Record<string, string>) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'i18n-extractor-'));
  directories.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
};

export const translatorType =
  'type T<N extends string> = ((key: string) => string) & { __i18nNamespace?: N };';
