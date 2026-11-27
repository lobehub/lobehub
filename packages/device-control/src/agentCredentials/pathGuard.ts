import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** The RPC error for a file operation that reaches into the credential store. */
export const AGENT_CREDENTIAL_ACCESS_DENIED_MESSAGE = 'Access to agent credentials is not allowed';

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const normalize = (target: string) => (caseInsensitive ? target.toLowerCase() : target);

const contains = (root: string, target: string) => {
  const relative = path.relative(normalize(root), normalize(target));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

/**
 * `~` / `~/…` as the home directory, as the file handlers expand it before
 * they touch the path (see `filePreview.ts`, `workspaceGuard.ts`): the guard
 * must judge the path they will actually open.
 */
const expandHomePath = (target: string): string => {
  if (target === '~') return os.homedir();
  if (target.startsWith('~/') || target.startsWith('~\\')) {
    return path.join(os.homedir(), target.slice(2));
  }
  return target;
};

/**
 * `target` with every symlink resolved, also when it does not exist yet: the
 * deepest existing ancestor is resolved and the missing tail appended, so a
 * write through a linked parent directory is caught before it creates a file.
 */
const realpathOrAncestor = async (target: string): Promise<string> => {
  let current = target;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
};

/**
 * Whether `target` lies inside the agent-credential store at `rootDir`, after
 * resolving `..` and symlinks on both sides. Relative targets resolve against
 * `baseDir` (the RPC's working directory) when given.
 */
export const isPathInsideAgentCredentialRoot = async (
  target: string,
  rootDir: string,
  baseDir?: string,
  /** Also true when `target` contains the store: an operation on a whole tree reaches it. */
  subtree = false,
): Promise<boolean> => {
  const resolvedRoot = path.resolve(rootDir);
  const realRoot = await realpathOrAncestor(resolvedRoot);
  const expanded = expandHomePath(target);
  const resolved = baseDir ? path.resolve(baseDir, expanded) : path.resolve(expanded);
  const real = await realpathOrAncestor(resolved);
  return [resolved, real].some(
    (candidate) =>
      contains(resolvedRoot, candidate) ||
      contains(realRoot, candidate) ||
      (subtree && (contains(candidate, resolvedRoot) || contains(candidate, realRoot))),
  );
};

/** A path an RPC touches, with the directory a relative one resolves against. */
export interface GuardedPath {
  baseDir?: string;
  path: string;
  /**
   * The operation moves, copies or deletes the whole tree at `path`, so a
   * path that contains the store (`~`, `~/.lobehub`) is refused too: copying
   * it would carry the store out of the guard.
   */
  subtree?: boolean;
}

/**
 * Throw the generic access error when any of `targets` lies inside the
 * credential store. The error never names the path or the store.
 */
export const assertOutsideAgentCredentialRoot = async (
  targets: GuardedPath[],
  rootDir: string,
): Promise<void> => {
  const inside = await Promise.all(
    targets.map((target) =>
      isPathInsideAgentCredentialRoot(target.path, rootDir, target.baseDir, target.subtree),
    ),
  );
  if (inside.some(Boolean)) throw new Error(AGENT_CREDENTIAL_ACCESS_DENIED_MESSAGE);
};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * The filesystem paths a device-control file RPC reads, lists or writes, so
 * the dispatcher can refuse those inside the credential store. Methods that
 * touch no caller-chosen path (git, terminal, updates, credentials) map to
 * none. `runWorktreeFileOperation` re-enters the dispatcher with its inner
 * RPC, which is checked there.
 */
export const fileRpcGuardedPaths = (method: string, params: unknown): GuardedPath[] => {
  const p = (params ?? {}) as Record<string, unknown>;
  const at = (value: unknown, baseDir?: unknown, subtree = false): GuardedPath[] => {
    const target = str(value);
    return target ? [{ baseDir: str(baseDir), path: target, ...(subtree && { subtree }) }] : [];
  };

  switch (method) {
    case 'browseDirectory':
    case 'statPath': {
      return at(p.path);
    }
    case 'initWorkspace':
    case 'listProjectSkills':
    case 'listClaudeCodeMemory':
    case 'getProjectFileIndex':
    case 'searchProjectFiles': {
      return at(p.scope);
    }
    case 'listProjectDirectory': {
      const root = str(p.root);
      if (!root) return [];
      return at(p.relativePath ?? '.', root).concat(at(root));
    }
    case 'getLocalFilePreview':
    case 'readExternalAssetForPublish': {
      return at(p.path, p.workingDirectory);
    }
    case 'copyAssetForPublish': {
      return [...at(p.from, p.workingDirectory, true), ...at(p.to, p.workingDirectory)];
    }
    case 'moveLocalFiles': {
      return list(p.items).flatMap((item) => {
        const entry = (item ?? {}) as Record<string, unknown>;
        return [...at(entry.oldPath, undefined, true), ...at(entry.newPath)];
      });
    }
    case 'renameLocalFile': {
      const file = str(p.path);
      const newName = str(p.newName);
      if (!file) return [];
      return [
        { path: file, subtree: true },
        ...(newName ? [{ path: path.join(path.dirname(file), newName) }] : []),
      ];
    }
    case 'writeLocalFile':
    case 'createLocalFile':
    case 'createLocalDirectory': {
      return at(p.path);
    }
    case 'copyLocalFiles': {
      return list(p.items).flatMap((item) => {
        const entry = (item ?? {}) as Record<string, unknown>;
        return [...at(entry.sourcePath, undefined, true), ...at(entry.targetPath)];
      });
    }
    case 'trashLocalFiles': {
      return list(p.paths).flatMap((target) => at(target, undefined, true));
    }
    default: {
      return [];
    }
  }
};
