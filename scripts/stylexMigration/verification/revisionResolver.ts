import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { git } from './git';
import type { RevisionSession } from './types';

export const resolveCommit = async (repository: string, ref: string) => {
  if (!ref || ref.startsWith('-') || /[\s\0]/.test(ref)) throw new Error('INVALID_REVISION');
  const sha = (
    await git(repository, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
  )
    .toString()
    .trim();
  if (!/^(?:[\da-f]{40}|[\da-f]{64})$/.test(sha)) throw new Error('INVALID_COMMIT_ID');
  return sha;
};

/** B is the target tip, not the merge-base. M includes concurrent changes from B. */
export const createRevisionSession = async (
  repository: string,
  base: string,
  head: string,
): Promise<RevisionSession> => {
  const sourceRepository = await realpath(repository);
  const [baseSha, headSha, format, commonDirectory] = await Promise.all([
    resolveCommit(sourceRepository, base),
    resolveCommit(sourceRepository, head),
    git(sourceRepository, ['rev-parse', '--show-object-format']),
    git(sourceRepository, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ]);
  let shallow: string | undefined;
  if (
    (await git(sourceRepository, ['rev-parse', '--is-shallow-repository'])).toString().trim() ===
    'true'
  ) {
    // A shallow checkout is safe only when no cut edge occurs between B/H and
    // their common ancestor. Copy those boundaries into the owned object DB.
    const shallowPath = (
      await git(sourceRepository, ['rev-parse', '--path-format=absolute', '--git-path', 'shallow'])
    )
      .toString()
      .trim();
    shallow = await readFile(shallowPath, 'utf8');
    const bases = (await git(sourceRepository, ['merge-base', '--all', baseSha, headSha]))
      .toString()
      .trim()
      .split('\n');
    if (bases.length !== 1 || !bases[0]) throw new Error('SHALLOW_MERGE_BASE_UNPROVEN');
    const region = new Set(
      (await git(sourceRepository, ['rev-list', baseSha, headSha, '--not', ...bases]))
        .toString()
        .trim()
        .split('\n'),
    );
    if (
      shallow
        .trim()
        .split('\n')
        .some((sha) => region.has(sha))
    )
      throw new Error('SHALLOW_RELEVANT_HISTORY_INCOMPLETE');
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'stylex-verification-git-'));
  try {
    await git(directory, ['init', '--bare', `--object-format=${format.toString().trim()}`, '.']);
    const objects = path.join(commonDirectory.toString().trim(), 'objects');
    if (/[\r\n]/.test(objects)) throw new Error('INVALID_OBJECT_DIRECTORY');
    await writeFile(path.join(directory, 'objects/info/alternates'), `${objects}\n`);
    if (shallow) await writeFile(path.join(directory, 'shallow'), shallow);
    const merged = (
      await git(directory, ['merge-tree', '--write-tree', baseSha, headSha])
    ).toString();
    const candidateTreeSha = merged.split('\n')[0];
    if (!/^(?:[\da-f]{40}|[\da-f]{64})$/.test(candidateTreeSha))
      throw new Error('INVALID_CANDIDATE_TREE');
    return {
      directory,
      identity: { baseSha, candidateTreeSha, headSha, repository: sourceRepository },
      sourceRepository,
    };
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
};

/** Only callers holding the session returned above can clean this owned scratch repo. */
export const closeRevisionSession = async (session: RevisionSession) => {
  if (
    path.dirname(session.directory) !== (await realpath(tmpdir())) &&
    path.dirname(session.directory) !== tmpdir()
  )
    throw new Error('REFUSE_UNOWNED_CLEANUP');
  if (!path.basename(session.directory).startsWith('stylex-verification-git-'))
    throw new Error('REFUSE_UNOWNED_CLEANUP');
  await rm(session.directory, { force: true, recursive: true });
};
