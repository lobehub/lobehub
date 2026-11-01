import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const WORKSPACE_ESCAPE_MESSAGE = 'Path is outside the approved workspace';

const expandHomePath = (target: string): string => {
  if (target === '~') return homedir();
  if (target.startsWith('~/') || target.startsWith('~\\')) {
    return path.join(homedir(), target.slice(2));
  }
  return target;
};

// A path that does not exist yet (a file about to be created, nested folders
// `a/b` created on the way) resolves through its nearest existing ancestor,
// with the missing tail re-appended.
const realpathForCreate = async (target: string): Promise<string> => {
  const missing: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...missing);
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
};

/**
 * Where an entry really lives: its parent folder resolved through symlinks, its
 * own name kept as-is. Resolving the parent stops a path that walks *through* a
 * symlinked folder (`<root>/link/secret` with `link → /etc`) from escaping,
 * while the entry itself may still be a symlink — renaming, copying or trashing
 * the link acts on the link, never on what it points to.
 */
const resolveEntry = async (target: string, realRoot: string): Promise<string> => {
  const absolute = path.resolve(realRoot, expandHomePath(target));
  const realParent = await realpathForCreate(path.dirname(absolute));
  return path.join(realParent, path.basename(absolute));
};

/**
 * Device-side containment for file mutations. The server's check is lexical
 * (it cannot see the device's filesystem), so the device re-checks every path
 * against the real workspace root before touching disk. Entries must sit
 * strictly inside the root: the root itself is never a mutation target.
 */
export const assertEntriesWithinWorkspace = async (
  workspaceRoot: string,
  targets: string[],
): Promise<void> => {
  const realRoot = await realpathForCreate(expandHomePath(workspaceRoot));
  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;

  for (const target of targets) {
    const entry = await resolveEntry(target, realRoot);
    if (!entry.startsWith(prefix)) {
      throw new Error(`${WORKSPACE_ESCAPE_MESSAGE}: ${target}`);
    }
  }
};
