import { constants } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseSwarmLanePath, SWARM_LANES_DIR } from '@lobechat/utils/goalSwarm';

const exists = async (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

const COPY = { mode: constants.COPYFILE_FICLONE, recursive: true, verbatimSymlinks: true };

/** Holds the files each lane was graded on when it took the lead. */
export const SWARM_BEST_DIR = '_best';
/** Names the swarm that owns `.lanes`, so a later swarm does not read its copies as its own. */
export const SWARM_MARKER = '.swarm';

/** Where a lane's best-scoring files are kept: `<workspace>/.lanes/_best/<key>`. */
export const swarmLaneBestDirectory = (workspace: string, key: string) =>
  path.join(workspace, SWARM_LANES_DIR, SWARM_BEST_DIR, key);

/**
 * Swarm bookkeeping, not workspace content: the lane copies themselves and the
 * `.lanes-<id>` archives left by an earlier swarm. Copying them into a lane (or
 * into the pre-promotion snapshot) would nest one swarm's work inside another.
 */
const isBookkeeping = (entry: string) =>
  entry === SWARM_LANES_DIR || entry.startsWith(`${SWARM_LANES_DIR}-`);

/**
 * Copy every entry of `from` except `.lanes` into `into`. Entry by entry: a
 * lane lives inside the workspace, and `cp` refuses to copy a directory into
 * its own subdirectory even when a filter would skip it. Copy-on-write where
 * the file system supports it (APFS, btrfs, XFS), a plain copy elsewhere.
 */
const copyEntries = async (from: string, into: string) => {
  await mkdir(into, { recursive: true });
  for (const entry of await readdir(from)) {
    if (isBookkeeping(entry)) continue;
    await cp(path.join(from, entry), path.join(into, entry), COPY);
  }
};

/** Parts of a linked worktree's gitdir that live in the shared repository, not in the copy. */
const BORROWED_FROM_COMMON = ['commondir', 'config', 'gitdir', 'objects', 'packed-refs', 'refs'];

/**
 * A linked worktree of a bare repository borrows a `config` that says `core.bare = true`,
 * because the shared repository is the bare one. The copy is a working tree, so it has to
 * say so: left bare, every `git status`, `add` or `checkout` in the lane fails with
 * "this operation must be run in a work tree".
 */
const normalizeBareConfig = async (gitDir: string) => {
  const file = path.join(gitDir, 'config');
  const config = await readFile(file, 'utf8').catch(() => undefined);
  const bare = /^[^\S\n]*bare[^\S\n]*=[^\S\n]*true[^\S\n]*$/m;
  if (!config || !bare.test(config)) return;
  await writeFile(
    file,
    config.replace(bare, (line) => line.replace('true', 'false')),
  );
};

/**
 * A repository's own `.git` directory travels with the copy: index and HEAD are
 * inside it, so a lane stages and commits on its own.
 *
 * A linked worktree is the exception. There `.git` is a one-line pointer file, so
 * copying the workspace verbatim makes every lane (and the original workspace)
 * read and write the *same* gitdir — one index, one HEAD, one set of refs. Give
 * the copy a self-contained gitdir instead: the borrowed parts of the shared
 * repository (`objects`, `refs`, `config`) plus the worktree's own state
 * (`HEAD`, index, logs).
 */
const materializeGitDir = async (from: string, into: string) => {
  const pointer = await readFile(path.join(into, '.git'), 'utf8').catch(() => undefined);
  if (!pointer?.startsWith('gitdir:')) return;

  const source = path.resolve(from, pointer.slice('gitdir:'.length).trim());
  const common = (
    await readFile(path.join(source, 'commondir'), 'utf8').catch(() => undefined)
  )?.trim();
  // Not a linked worktree after all: keep the copied pointer rather than guess at its layout.
  if (!common) return;
  const shared = path.resolve(source, common);
  const gitDir = path.join(into, '.git');

  const copyFrom = async (dir: string, skip: string[]) => {
    for (const entry of await readdir(dir)) {
      if (skip.includes(entry)) continue;
      await cp(path.join(dir, entry), path.join(gitDir, entry), COPY);
    }
  };

  await rm(gitDir, { force: true });
  await mkdir(gitDir, { recursive: true });
  // The shared repository first — `index`, `logs` and `HEAD` belong to one worktree, so they
  // come from the worktree itself, in the second pass.
  await copyFrom(shared, ['index', 'logs', 'worktrees']);
  await copyFrom(source, BORROWED_FROM_COMMON);
  await normalizeBareConfig(gitDir);
};

/**
 * Copy the workspace `from` into `to`, written into a sibling first and renamed,
 * so a lane directory is either complete or absent. `replace` allows landing on a
 * target that already holds a copy.
 */
export const copyWorkspace = async (
  from: string,
  to: string,
  options: { replace?: boolean } = {},
) => {
  const staging = `${to}.partial-${process.pid}`;
  await rm(staging, { force: true, recursive: true });
  await copyEntries(from, staging);
  await materializeGitDir(from, staging);
  if (!options.replace) {
    await rename(staging, to);
    return;
  }
  // `rename` refuses to land on an existing non-empty directory (ENOTEMPTY), so a
  // second copy onto the same target would fail after the score was recorded. Move
  // the old copy aside first, then drop it: the target is missing only between two
  // renames and never holds a half-written tree.
  const retired = `${to}.retired-${process.pid}`;
  await rm(retired, { force: true, recursive: true });
  if (await exists(to)) await rename(to, retired);
  await rename(staging, to);
  await rm(retired, { force: true, recursive: true });
};

/**
 * A swarm lane's first run starts in `<workspace>/.lanes/<key>`, which does not
 * exist yet: make it a copy of the workspace. Any other directory, or a lane
 * that already exists, is returned untouched.
 */
export const prepareSwarmLane = async (cwd: string): Promise<string> => {
  const lane = parseSwarmLanePath(cwd);
  if (!lane || path.resolve(cwd) !== path.resolve(lane.workspace, SWARM_LANES_DIR, lane.key))
    return cwd;
  if (await exists(cwd)) return cwd;
  if (!(await exists(lane.workspace))) return cwd;
  await copyWorkspace(lane.workspace, cwd);
  return cwd;
};

/** Replace `target`'s contents (but its `.lanes`) with `source`'s, keeping the old ones in `snapshot`. */
const replaceContents = async (
  source: string,
  target: string,
  snapshot: string,
  options: { keepGit?: boolean } = {},
) => {
  await rm(snapshot, { force: true, recursive: true });
  await copyWorkspace(target, snapshot);
  // A promoted workspace keeps its own `.git`: a lane's gitdir was materialized for the copy,
  // so landing it here would turn a linked worktree into an unrelated standalone repository and
  // leave the parent branch — and this worktree's registration — pointing at the old HEAD.
  const skip = (entry: string) =>
    isBookkeeping(entry) || (Boolean(options.keepGit) && entry === '.git');
  for (const entry of await readdir(target)) {
    if (!skip(entry)) await rm(path.join(target, entry), { force: true, recursive: true });
  }
  for (const entry of await readdir(source)) {
    if (skip(entry)) continue;
    await cp(path.join(source, entry), path.join(target, entry), COPY);
  }
};

/**
 * Adopt another lane's work: the calling lane (found from `cwd`) takes `fromKey`'s
 * files; its own are kept in `.lanes/_<key>_before_adopt`.
 */
export const adoptSwarmLane = async (cwd: string, fromKey: string) => {
  const lane = parseSwarmLanePath(cwd);
  if (!lane) throw new Error('Run this from inside a swarm lane (<workspace>/.lanes/<key>).');
  if (lane.key === fromKey) throw new Error('A lane cannot adopt itself.');
  const lanes = path.join(lane.workspace, SWARM_LANES_DIR);
  const source = path.join(lanes, fromKey);
  if (!(await exists(source))) throw new Error(`Lane ${fromKey} has no directory at ${source}.`);
  const snapshot = path.join(lanes, `_${lane.key}_before_adopt`);
  await replaceContents(source, path.join(lanes, lane.key), snapshot);
  return { snapshot, source, target: path.join(lanes, lane.key) };
};

/**
 * Keep the files a lane was just graded on, when that run took the goal-wide
 * lead. Evaluation records only score and fingerprint, so without this copy the
 * champion's files are whatever the lane left behind — and a deadline that cuts
 * a lane mid-edit would promote a tree that scores worse than the leaderboard
 * claims. Only a new goal-wide best is copied: that is the state champion
 * selection can point at.
 *
 * A lane can take the lead more than once, so a snapshot replaces the previous
 * one — a leaderboard that reports the later score must promote its files, not
 * the first best's.
 */
export const snapshotSwarmLaneBest = async (cwd: string) => {
  const lane = parseSwarmLanePath(cwd);
  if (!lane) return undefined;
  const from = path.join(lane.workspace, SWARM_LANES_DIR, lane.key);
  if (!(await exists(from))) return undefined;
  const to = swarmLaneBestDirectory(lane.workspace, lane.key);
  await copyWorkspace(from, to, { replace: true });
  return to;
};

/** Which swarm owns `<workspace>/.lanes`, or undefined when it was never staked. */
export const readSwarmOwner = async (workspace: string) =>
  readFile(path.join(workspace, SWARM_LANES_DIR, SWARM_MARKER), 'utf8').then(
    (value) => value.trim(),
    () => undefined,
  );

/**
 * Claim `<workspace>/.lanes` for one swarm. Lane keys restart at `A` for every
 * swarm, so without an owner the second swarm in a workspace would start from
 * the first one's copies and overwrite whatever the workspace gained since.
 * A retry of the same swarm keeps its lanes; another swarm's lanes are moved
 * aside to `<workspace>/.lanes-<owner>` instead of being reused or deleted.
 */
export const stakeSwarmLanes = async (workspace: string, swarmId: string) => {
  if (!(await exists(workspace))) return undefined;
  const lanes = path.join(workspace, SWARM_LANES_DIR);
  const owner = await readSwarmOwner(workspace);
  if (owner === swarmId) return lanes;
  if (await exists(lanes)) {
    const archive = `${lanes}-${(owner ?? 'unstaked').replaceAll(/[^\w-]/g, '_')}`;
    await rm(archive, { force: true, recursive: true });
    await rename(lanes, archive);
  }
  await mkdir(lanes, { recursive: true });
  await writeFile(path.join(lanes, SWARM_MARKER), `${swarmId}\n`);
  return lanes;
};

/**
 * Promote a lane into the workspace: the workspace (minus swarm bookkeeping) is
 * kept in `.lanes/_before_promote`, then replaced by the lane's files — the ones
 * it was graded on when it took the lead, falling back to its current files for
 * a lane that never recorded a led evaluation.
 */
export const promoteSwarmLane = async (workspace: string, key: string) => {
  const lanes = path.join(workspace, SWARM_LANES_DIR);
  const live = path.join(lanes, key);
  if (!(await exists(live))) throw new Error(`Lane ${key} has no directory at ${live}.`);
  const best = swarmLaneBestDirectory(workspace, key);
  const source = (await exists(best)) ? best : live;
  const snapshot = path.join(lanes, '_before_promote');
  await replaceContents(source, workspace, snapshot, { keepGit: true });
  return { graded: source === best, snapshot, source, target: workspace };
};
