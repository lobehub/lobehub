import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { digestFile } from '../dependencies/dependencySnapshot';
import { sha256, writeJson } from '../reporting/report';

const names = ['base-source', 'candidate-source'] as const;
const inputs = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'capsule.json'];
const statIfPresent = async (file: string) => {
  try {
    return await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

/** Only the two owned exports under a unique run directory are removable. */
export const cleanupSourceSnapshots = async (output: string) => {
  const root = await realpath(output);
  const present: string[] = [];
  // Validate every target before deleting any: refuse links, including partial runs.
  for (const name of names) {
    const file = path.join(root, name);
    const stat = await statIfPresent(file);
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error('REFUSE_SOURCE_CLEANUP_SYMLINK');
    if (!stat.isDirectory() || (await realpath(file)) !== file)
      throw new Error('REFUSE_UNOWNED_SOURCE_CLEANUP');
    present.push(name);
  }
  const metadata: Array<{ path: string; sha256: string }> = [];
  for (const name of present) {
    const preserve = async (relative: string) => {
      const source = path.join(root, name, relative);
      const stat = await statIfPresent(source);
      if (!stat) return;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 ** 2)
        throw new Error('UNSAFE_SOURCE_METADATA');
      if (!(await realpath(source)).startsWith(path.join(root, name) + path.sep))
        throw new Error('SOURCE_METADATA_ESCAPE');
      const destination = path.join(root, 'source-metadata', name, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await copyFile(source, destination, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if ((await digestFile(source)) !== (await digestFile(destination)))
          throw new Error('SOURCE_METADATA_ALREADY_DIFFERENT', { cause: error });
      }
      metadata.push({
        path: path.relative(root, destination),
        sha256: await digestFile(destination),
      });
    };
    for (const prefix of ['', '.stylex-dependencies/']) {
      for (const input of inputs) {
        await preserve(`${prefix}${input}`);
      }
    }
    const preserveLogs = async (relative: string): Promise<void> => {
      const directory = path.join(root, name, relative);
      const stat = await statIfPresent(directory);
      if (!stat) return;
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error('UNSAFE_SOURCE_LOG_DIRECTORY');
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('UNSAFE_SOURCE_LOG_SYMLINK');
        if (entry.isFile() && entry.name.endsWith('.log'))
          await preserve(path.join(relative, entry.name));
      }
    };
    await preserveLogs('.stylex-tools');
    await preserveLogs('.stylex-dependencies/.stylex-tools');
    // Build workers write one log per fixture. Do not traverse pnpm caches.
    const fixtures = path.join(root, name, '.stylex-tools/fixtures');
    const fixtureStat = await statIfPresent(fixtures);
    if (fixtureStat) {
      if (!fixtureStat.isDirectory() || fixtureStat.isSymbolicLink())
        throw new Error('UNSAFE_FIXTURE_LOG_DIRECTORY');
      for (const fixture of await readdir(fixtures, { withFileTypes: true })) {
        if (!fixture.isDirectory() || fixture.isSymbolicLink())
          throw new Error('UNSAFE_FIXTURE_LOG_DIRECTORY');
        await preserveLogs(path.join('.stylex-tools/fixtures', fixture.name));
      }
    }
    await rm(path.join(root, name), { recursive: true });
  }
  return { metadata, metadataHash: sha256(JSON.stringify(metadata)), removed: present };
};

export const recordSourceCleanup = async (output: string) => {
  const result = await cleanupSourceSnapshots(output);
  await writeJson(output, 'source-cleanup.json', {
    ...result,
    retainedDiagnostics: 'source-metadata/<side>/.stylex-tools (including dependency capsule logs)',
    policy: 'remove-owned-sources-after-run',
  });
};
