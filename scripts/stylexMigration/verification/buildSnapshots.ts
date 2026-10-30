import { createHash } from 'node:crypto';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { git } from './git';
import type { RevisionSession, SourceEntry } from './types';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export const listSourceEntries = async (
  repository: string,
  tree: string,
): Promise<SourceEntry[]> => {
  const output = (await git(repository, ['ls-tree', '-r', '-l', '-z', tree])).toString();
  return output
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [mode, type, oid, size] = line.slice(0, tab).trim().split(/\s+/);
      const file = line.slice(tab + 1);
      if (
        tab < 0 ||
        !file ||
        path.isAbsolute(file) ||
        file.split('/').some((part) => ['..', '.', '.git', ''].includes(part)) ||
        file.includes('\\')
      )
        throw new Error('UNSAFE_SOURCE_PATH');
      return { bytes: size === '-' ? 0 : Number(size), mode, oid, path: file, type };
    });
};

/** Read blobs by object ID, never by interpolating a revision:path expression. */
export const readBlobs = async (repository: string, entries: SourceEntry[]) => {
  const output = await git(
    repository,
    ['cat-file', '--batch'],
    entries.map((entry) => entry.oid).join('\n') + '\n',
  );
  let cursor = 0;
  return entries.map((entry) => {
    const end = output.indexOf(10, cursor);
    const [oid, type, size] = output.subarray(cursor, end).toString().split(' ');
    if (end < 0 || oid !== entry.oid || type !== 'blob' || Number(size) !== entry.bytes)
      throw new Error('INVALID_GIT_BLOB_STREAM');
    cursor = end + 1;
    const value = output.subarray(cursor, cursor + entry.bytes);
    cursor += entry.bytes + 1;
    if (value.length !== entry.bytes || output[cursor - 1] !== 10)
      throw new Error('TRUNCATED_GIT_BLOB');
    return value;
  });
};

export const exportSourceTree = async (repository: string, tree: string, destination: string) => {
  const sourceTreeSha = (await git(repository, ['rev-parse', '--verify', `${tree}^{tree}`]))
    .toString()
    .trim();
  const entries = await listSourceEntries(repository, sourceTreeSha);
  if (
    entries.length > 150_000 ||
    entries.reduce((sum, entry) => sum + entry.bytes, 0) > 2 * 1024 ** 3
  )
    throw new Error('SOURCE_BUDGET_EXCEEDED');
  if (
    entries.some(
      (entry) => entry.type !== 'blob' || !['100644', '100755', '120000'].includes(entry.mode),
    )
  )
    throw new Error('SUBMODULE_OR_SOURCE_MODE_UNSUPPORTED');
  if (entries.some((entry) => entry.bytes > 32 * 1024 ** 2))
    throw new Error('SOURCE_BLOB_BUDGET_EXCEEDED');
  // Destination must be new: never overwrite user files or follow existing links.
  await mkdir(destination);
  const links: Array<{ file: string; target: string }> = [];
  for (let offset = 0; offset < entries.length;) {
    const batch: SourceEntry[] = [];
    let bytes = 0;
    do {
      const entry = entries[offset++];
      batch.push(entry);
      bytes += entry.bytes;
    } while (
      offset < entries.length &&
      bytes + entries[offset].bytes < 8 * 1024 ** 2 &&
      batch.length < 256
    );
    const blobs = await readBlobs(repository, batch);
    await Promise.all(
      batch.map(async (entry, index) => {
        const file = path.join(destination, entry.path);
        await mkdir(path.dirname(file), { recursive: true });
        if (entry.mode === '120000') {
          const target = blobs[index].toString();
          const resolved = path.resolve(path.dirname(file), target);
          if (
            path.isAbsolute(target) ||
            !resolved.startsWith(destination + path.sep) ||
            target.includes('\0')
          )
            throw new Error(`EXTERNAL_SOURCE_SYMLINK:${entry.path}`);
          links.push({ file, target });
        } else
          await writeFile(file, blobs[index], {
            flag: 'wx',
            mode: entry.mode === '100755' ? 0o755 : 0o644,
          });
      }),
    );
  }
  // Reject chains: lexical containment alone is insufficient when a target
  // traverses another link before '..' is resolved by the operating system.
  const linkPaths = links.map((link) => link.file);
  for (const link of links) {
    const target = path.resolve(path.dirname(link.file), link.target);
    if (
      link.target.includes('\\') ||
      linkPaths.some((file) => target === file || target.startsWith(file + path.sep))
    )
      throw new Error('SOURCE_SYMLINK_CHAIN_UNSUPPORTED');
  }
  // Links are created last. No file write can traverse an untrusted link.
  for (const link of links) await symlink(link.target, link.file);
  const dependencyInputs = entries.filter(
    (entry) =>
      path.basename(entry.path) === 'package.json' ||
      [
        'pnpm-workspace.yaml',
        'pnpm-lock.yaml',
        'package-lock.json',
        'bun.lock',
        '.npmrc',
        '.pnpmfile.cjs',
      ].includes(entry.path) ||
      entry.path.startsWith('patches/'),
  );
  return {
    dependencyInputHash: hash(JSON.stringify(dependencyInputs)),
    dependencyInputs,
    dependencyRestore: 'NOT_RESTORED' as const,
    directory: destination,
    fileCount: entries.length,
    sourceTreeSha,
  };
};

/** Full trees, including workspace sources: no alias fallback into the checkout. */
export const prepareSourceSnapshots = async (session: RevisionSession, runDirectory: string) => ({
  base: await exportSourceTree(
    session.directory,
    session.identity.baseSha,
    path.join(runDirectory, 'base-source'),
  ),
  candidate: await exportSourceTree(
    session.directory,
    session.identity.candidateTreeSha,
    path.join(runDirectory, 'candidate-source'),
  ),
});
