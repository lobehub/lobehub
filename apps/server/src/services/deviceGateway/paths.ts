/**
 * Path containment for device file operations. Device paths may be POSIX or
 * Windows while this runs on the (POSIX) server.
 */
import { isAbsolute, relative, resolve } from 'pathe';

/**
 * Is `target` the same as, or nested inside, `root`?
 *
 * The device's working directory may be a POSIX path (`/Users/…`) or a Windows
 * path (`C:\…` / `\\server\share`) while this check runs on the cloud server
 * (POSIX). `pathe` auto-detects the path flavour per argument, so Windows
 * device paths are resolved with Windows semantics without us branching on
 * `path.win32` / `path.posix`.
 */
export const isPathWithinRoot = (root: string, target: string): boolean => {
  if (!isAbsolute(root) || !isAbsolute(target)) return false;
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * Guard the web/remote file mutations (move / rename / write) against escaping
 * the project root. These routes accept absolute paths straight from an
 * untrusted browser session, so before forwarding them to a device we confirm
 * every path stays inside the workspace the UI is operating in — otherwise a
 * caller could bypass the Files tree and mutate arbitrary locations on the
 * device. Mirrors the read path's `workspaceRoot` containment check.
 */
export const assertPathsWithinWorkspace = (
  workspaceRoot: string,
  candidates: Array<string | undefined>,
): void => {
  if (!workspaceRoot) throw new Error('A workspace root is required for file mutations');

  for (const candidate of candidates) {
    if (!candidate || !isPathWithinRoot(workspaceRoot, candidate)) {
      throw new Error(`Path is outside the approved workspace: ${candidate ?? '(empty)'}`);
    }
  }
};

/**
 * Append one segment to a device path, keeping the device's own separator. The
 * folder picker browses Windows devices too (`C:\Users`), and `pathe.join`
 * would rewrite those to forward slashes.
 */
export const joinDevicePath = (parentPath: string, name: string): string => {
  const separator = /^[A-Z]:\\/i.test(parentPath) || parentPath.startsWith('\\\\') ? '\\' : '/';
  return `${parentPath.replace(/[\\/]+$/, '')}${separator}${name}`;
};

/**
 * Refuse to trash / rename / move / duplicate the workspace root itself. It
 * passes the containment check (a root is "within" itself), but removing or
 * renaming it pulls the whole Files tree out from under the UI, and a duplicate
 * of the root would land in its parent — outside the workspace.
 */
export const assertNotWorkspaceRoot = (
  workspaceRoot: string,
  candidates: Array<string | undefined>,
): void => {
  for (const candidate of candidates) {
    if (
      candidate &&
      isAbsolute(candidate) &&
      relative(resolve(workspaceRoot), resolve(candidate)) === ''
    ) {
      throw new Error(`This operation is not allowed on the workspace root: ${candidate}`);
    }
  }
};
