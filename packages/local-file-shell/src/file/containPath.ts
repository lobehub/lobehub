import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve a path to its real, absolute location, following symlinks. Falls back
 * to `path.resolve` when the target does not exist yet (so a not-yet-created
 * file still resolves) — mirrors the `safeRealpath` helper used in
 * `git/worktrees.ts`.
 */
const safeRealpath = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
};

/**
 * Resolve a target path for containment checking.
 *
 * For paths that may not exist yet (the write/create case) we cannot `realpath`
 * the full path, so we `realpath` the nearest existing ancestor and re-append
 * the remaining segments. This still defeats a symlinked *parent directory* that
 * would otherwise let a write escape the root, while permitting creation of a
 * new file inside the root.
 */
const resolveForContainment = async (target: string): Promise<string> => {
  const absolute = path.resolve(target);

  // Fast path: the target itself exists — resolve it (and any symlinks) directly.
  try {
    return await realpath(absolute);
  } catch {
    // Walk up to the nearest existing ancestor, realpath it, then re-join the
    // non-existent tail.
    let current = absolute;
    const tail: string[] = [];
    // Guard against an unbounded loop; the root is reached well before this.
    for (let i = 0; i < 4096; i += 1) {
      const parent = path.dirname(current);
      if (parent === current) break; // reached filesystem root
      try {
        const realParent = await realpath(parent);
        return path.join(realParent, ...tail.reverse(), path.basename(current));
      } catch {
        tail.push(path.basename(current));
        current = parent;
      }
    }
    return absolute;
  }
};

/**
 * Decision returned by {@link ensurePathWithin}.
 */
export interface ContainmentResult {
  allowed: boolean;
  /** Present only when `allowed` is false. */
  reason?: string;
  /** Absolute, symlink-resolved path that was checked (best effort). */
  resolvedPath?: string;
}

/**
 * Resolve a (possibly relative) target against the caller's working directory.
 *
 * The file tools document relative paths as being relative to `workingDirectory`,
 * so a non-absolute target must be joined to that root *before* containment is
 * checked and *before* the sink touches the filesystem — otherwise it is resolved
 * against `process.cwd()` instead, which rejects or mislocates a legitimate
 * relative call. With no root, or an already-absolute target, the path is returned
 * unchanged (preserving the historical behavior).
 */
export const resolveWithinRoot = (
  target: string,
  workingDirectory: string | undefined,
): string =>
  workingDirectory && !path.isAbsolute(target) ? path.join(workingDirectory, target) : target;

/**
 * Enforce that `targetPath` resolves to a location inside `workingDirectory`
 * (the root the caller is scoped to), after resolving symlinks on both sides.
 *
 * Containment is **opt-in by presence of a root**: when `workingDirectory` is
 * empty/undefined no check is performed and the path is allowed, preserving the
 * historical behavior for callers that intentionally operate without a scope
 * (e.g. desktop sessions that grant full-disk access). When a root *is* supplied
 * the check is default-deny: absolute paths outside the root and `..` escapes
 * are rejected.
 */
export const ensurePathWithin = async (
  targetPath: string,
  workingDirectory: string | undefined,
): Promise<ContainmentResult> => {
  if (!workingDirectory) return { allowed: true };

  const resolvedRoot = await safeRealpath(workingDirectory);
  const resolvedTarget = await resolveForContainment(targetPath);

  const withSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;

  if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(withSep)) {
    return { allowed: true, resolvedPath: resolvedTarget };
  }

  return {
    allowed: false,
    reason: `Path escapes the allowed working directory: ${targetPath}`,
    resolvedPath: resolvedTarget,
  };
};
