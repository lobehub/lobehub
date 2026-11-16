import { constants } from 'node:fs';
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { parseSwarmLanePath, SWARM_LANES_DIR } from '@lobechat/utils/goalSwarm';

const exists = async (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

const COPY = { mode: constants.COPYFILE_FICLONE, recursive: true, verbatimSymlinks: true };

/**
 * Copy every entry of `from` except `.lanes` into `into`. Entry by entry: a
 * lane lives inside the workspace, and `cp` refuses to copy a directory into
 * its own subdirectory even when a filter would skip it. Copy-on-write where
 * the file system supports it (APFS, btrfs, XFS), a plain copy elsewhere.
 */
const copyEntries = async (from: string, into: string) => {
  await mkdir(into, { recursive: true });
  for (const entry of await readdir(from)) {
    if (entry === SWARM_LANES_DIR) continue;
    await cp(path.join(from, entry), path.join(into, entry), COPY);
  }
};

/**
 * Copy the workspace `from` into `to`, written into a sibling first and renamed,
 * so a lane directory is either complete or absent.
 */
export const copyWorkspace = async (from: string, to: string) => {
  const staging = `${to}.partial-${process.pid}`;
  await rm(staging, { force: true, recursive: true });
  await copyEntries(from, staging);
  await rename(staging, to);
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
const replaceContents = async (source: string, target: string, snapshot: string) => {
  await rm(snapshot, { force: true, recursive: true });
  await copyWorkspace(target, snapshot);
  for (const entry of await readdir(target)) {
    if (entry !== SWARM_LANES_DIR)
      await rm(path.join(target, entry), { force: true, recursive: true });
  }
  await copyEntries(source, target);
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
 * Promote a lane into the workspace: the workspace (minus `.lanes`) is kept in
 * `.lanes/_before_promote`, then replaced by the lane's files.
 */
export const promoteSwarmLane = async (workspace: string, key: string) => {
  const lanes = path.join(workspace, SWARM_LANES_DIR);
  const source = path.join(lanes, key);
  if (!(await exists(source))) throw new Error(`Lane ${key} has no directory at ${source}.`);
  const snapshot = path.join(lanes, '_before_promote');
  await replaceContents(source, workspace, snapshot);
  return { snapshot, source, target: workspace };
};
