import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, realpath, rm } from 'node:fs/promises';
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
    for (const prefix of ['', '.stylex-dependencies/']) {
      for (const input of inputs) {
        const relative = `${prefix}${input}`;
        const source = path.join(root, name, relative);
        const stat = await statIfPresent(source);
        if (!stat) continue;
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 ** 2)
          throw new Error('UNSAFE_SOURCE_METADATA');
        if (!(await realpath(source)).startsWith(path.join(root, name) + path.sep))
          throw new Error('SOURCE_METADATA_ESCAPE');
        const destination = path.join(root, 'source-metadata', name, relative);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        metadata.push({
          path: path.relative(root, destination),
          sha256: await digestFile(destination),
        });
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
    policy: 'remove-owned-sources-after-run',
  });
};
