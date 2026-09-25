import { randomBytes } from 'node:crypto';
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Per-path write queue for this process.
 *
 * The runtime can hand several edits to the same file to the device at once
 * (a tool batch runs its calls concurrently and the gateway handles every
 * request on its own), and a read → replace → write that is not serialized
 * lets one call overwrite another's change while both report success. Every
 * mutation of a file in this package runs through here, so two calls on one
 * path always see each other's result.
 */
const pathQueues = new Map<string, Promise<unknown>>();

/**
 * Case-insensitive file systems (the default on Windows and macOS) map
 * `Foo.ts` and `foo.ts` to one file. Folding case there only ever
 * over-serializes on a case-sensitive volume, which is harmless.
 */
const lockKey = (filePath: string) => {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
};

export const withFileLock = async <T>(filePath: string, task: () => Promise<T>): Promise<T> => {
  const key = lockKey(filePath);
  const previous = pathQueues.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);
  // The queue tail must never reject, or the next caller would inherit it.
  const tail = current.catch(() => {});
  pathQueues.set(key, tail);

  try {
    return await current;
  } finally {
    // Drop the entry once nothing is queued behind this call, so the map does
    // not grow with every file ever touched.
    if (pathQueues.get(key) === tail) pathQueues.delete(key);
  }
};

/** Errors a rename over an existing file can hit on Windows when something else holds it open. */
const RENAME_BLOCKED_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

/**
 * Write `content` so no reader ever sees a half-written file: write a sibling
 * temp file, then rename it over the target. `writeFile` in place truncates
 * first and writes from offset 0, so two overlapping writes (or a read in the
 * middle of one) produce an empty file, a duplicated tail, or a UTF-8
 * sequence cut in half.
 *
 * Symlinks are followed so the link itself is kept, and the target's mode is
 * carried over. When the rename is refused (another process holding the file
 * open on Windows), fall back to an in-place write — still serialized by
 * {@link withFileLock}, and still checked by {@link verifyWrittenContent}.
 */
export const writeFileAtomic = async (filePath: string, content: string): Promise<void> => {
  let target = filePath;
  let mode: number | undefined;
  try {
    target = await realpath(filePath);
    mode = (await stat(target)).mode;
  } catch {
    // New file: nothing to follow or preserve.
  }

  const tempPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`,
  );

  try {
    await writeFile(tempPath, content, 'utf8');
    if (mode !== undefined) await chmod(tempPath, mode);
    await rename(tempPath, target);
  } catch (error) {
    await rm(tempPath, { force: true });
    if (!RENAME_BLOCKED_CODES.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
    await writeFile(target, content, 'utf8');
  }
};

/**
 * Read the file back and confirm it holds exactly what was written, so a
 * success result reflects the disk rather than the in-memory replacement.
 * Returns an error message when it does not.
 */
export const verifyWrittenContent = async (
  filePath: string,
  expected: string,
): Promise<string | undefined> => {
  const actual = await readFile(filePath, 'utf8');
  if (actual === expected) return;

  return `The write to ${filePath} did not persist: reading it back returned ${Buffer.byteLength(actual, 'utf8')} bytes instead of the expected ${Buffer.byteLength(expected, 'utf8')}. Another process may have modified the file — read it again before retrying.`;
};
