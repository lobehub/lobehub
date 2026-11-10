/**
 * Derive the target directory for a new worktree under the central root
 * `<homeDir>/.lobehub/worktrees/<repoKey>/<branchFolder>`, e.g. `/code/lobehub`
 * + `feat/x` → `/Users/me/.lobehub/worktrees/lobehub-1a2b3c4d/feat-x`. `repoKey`
 * is the repo folder name plus a short hash of the source path, so two repos
 * that share a name never land in the same folder. Preserves the source path's
 * separator so Windows paths stay intact, and folds ref-illegal characters in
 * the branch to `-` for the folder.
 *
 * Shared by the renderer (path preview + local IPC call) and the server
 * (`device.addGitWorktree`), which re-derives the target from the trusted
 * `path` + `branch` rather than trusting a client-supplied absolute path — so a
 * crafted web request can't ask a remote device to check out at an arbitrary
 * location. Both callers must derive identically, hence the single source here.
 *
 * This package also runs in the browser, so the caller passes the home
 * directory of the machine that owns the repo (the server reads it from the
 * device's reported `homePath`). Without one it falls back to the previous
 * layout, a `<repoName>-<branch>` sibling of the source repo, so a device that
 * cannot report its home still gets a usable absolute path. Existing sibling
 * worktrees are untouched — `git worktree list` still reports them.
 */
const isSep = (ch: string): boolean => ch === '/' || ch === '\\';

const WORKTREE_ROOT_SEGMENTS = ['.lobehub', 'worktrees'] as const;

/** Folder used when the branch folds to nothing (empty or all illegal characters). */
const EMPTY_BRANCH_FOLDER = 'worktree';

/**
 * 32-bit FNV-1a as 8 hex chars. Not for security — only to tell same-named repos
 * apart — but it must be synchronous and identical in the browser and on Node,
 * which rules out `crypto.subtle` and `node:crypto`.
 */
const shortHash = (input: string): string => {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export interface DeriveWorktreePathOptions {
  /** Home directory of the machine that owns the repo; omitted → sibling layout. */
  homeDir?: string;
}

export const deriveWorktreePath = (
  sourcePath: string,
  branch: string,
  { homeDir }: DeriveWorktreePathOptions = {},
): string => {
  const sep = sourcePath.includes('\\') && !sourcePath.includes('/') ? '\\' : '/';
  // Strip trailing path separators, then the leading/trailing '-' of the folded
  // branch, both with linear scans rather than anchored /[…]+$/ quantifiers —
  // those are polynomial-ReDoS shapes (flagged by CodeQL) on a long crafted
  // input, and this runs per request on the server with untrusted path/branch.
  let te = sourcePath.length;
  while (te > 0 && isSep(sourcePath[te - 1])) te -= 1;
  const trimmed = sourcePath.slice(0, te);
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const parent = cut >= 0 ? trimmed.slice(0, cut) : '';
  const repoName = (cut >= 0 ? trimmed.slice(cut + 1) : trimmed) || 'repo';
  const folded = branch.trim().replaceAll(/[\s~^:?*[\]\\/]+/g, '-');
  let start = 0;
  let end = folded.length;

  if (!homeDir?.trim()) {
    while (start < end && folded[start] === '-') start += 1;
    while (end > start && folded[end - 1] === '-') end -= 1;
    const suffix = folded.slice(start, end);
    const folder = suffix ? `${repoName}-${suffix}` : repoName;
    return parent ? `${parent}${sep}${folder}` : folder;
  }

  // Leading '.' is stripped too: the folder sits inside the central root, so a
  // `.` / `..` branch must not resolve to the repo key folder or its parent.
  while (start < end && (folded[start] === '-' || folded[start] === '.')) start += 1;
  while (end > start && folded[end - 1] === '-') end -= 1;
  const branchFolder = folded.slice(start, end) || EMPTY_BRANCH_FOLDER;
  const repoKey = `${repoName}-${shortHash(trimmed)}`;

  let he = homeDir.length;
  while (he > 0 && isSep(homeDir[he - 1])) he -= 1;
  return [homeDir.slice(0, he), ...WORKTREE_ROOT_SEGMENTS, repoKey, branchFolder].join(sep);
};
