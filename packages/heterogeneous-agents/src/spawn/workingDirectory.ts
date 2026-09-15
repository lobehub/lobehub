import { type Stats, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';

import { HETERO_WORKING_DIRECTORY_NOT_FOUND } from './classifyProcessFailure';

/**
 * Working-directory checks shared by every heterogeneous-agent spawn site
 * (desktop main, `lh connect` daemon, `lh hetero exec`).
 *
 * Exposed as its own package subpath rather than through the `./spawn` barrel:
 * the connect daemon only needs these few lines, and the barrel pulls in the
 * agent SDKs and stream pipeline behind it.
 */

/**
 * `statSync` is the only filesystem primitive this module uses, so the
 * predicate and the message it produces can never disagree.
 */
const statDirectory = (dir: string): Stats | undefined => {
  try {
    return statSync(dir, { throwIfNoEntry: false });
  } catch {
    // An unreadable path (EACCES on a parent, symlink loop) is unusable too.
    return undefined;
  }
};

/**
 * Whether `dir` can be used as a child process `cwd`. An existence check alone
 * also accepts a regular file, and spawning with a file as `cwd` fails with
 * ENOTDIR — an errno no classifier maps to `working_directory_not_found`, so
 * the run would surface the generic error card instead of the
 * working-directory guide.
 */
export const isSpawnableDirectory = (dir: string): boolean =>
  statDirectory(dir)?.isDirectory() ?? false;

/** Single wording for the working-directory failure across CLI and desktop. */
export const describeUnusableWorkingDirectory = (dir: string): string =>
  statDirectory(dir)
    ? `Working directory is not a directory: ${dir}`
    : `Working directory does not exist: ${dir}`;

/**
 * Fail a run before spawn when its working directory is unusable, with the
 * `code` that `classifyHeteroProcessFailure` maps onto the working-directory
 * guide card.
 */
export const assertSpawnableWorkingDirectory = (dir: string): void => {
  if (isSpawnableDirectory(dir)) return;

  throw Object.assign(new Error(describeUnusableWorkingDirectory(dir)), {
    code: HETERO_WORKING_DIRECTORY_NOT_FOUND,
    workingDirectory: dir,
  });
};

/**
 * Pick the cwd to start the `lh hetero exec` wrapper process from. A stale
 * project path must not prevent the wrapper from starting: its inner
 * `spawnAgent` preflight owns cwd classification and reports the structured
 * `working_directory_not_found` error through `heteroFinish`, which the bare
 * `spawn ... ENOENT` of a failed wrapper spawn cannot.
 *
 * Falls through home and temp so the wrapper still starts when home itself is
 * unavailable (a disconnected network home). `undefined` means "inherit this
 * process's cwd", which stays valid as long as this process runs.
 */
export const resolveHeteroSpawnCwd = (workDir: string): string | undefined =>
  [workDir, homedir(), tmpdir()].find(
    (candidate) => !!candidate && isSpawnableDirectory(candidate),
  );
