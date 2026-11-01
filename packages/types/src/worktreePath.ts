/**
 * Derive the target directory for a new worktree: a sibling of the source repo
 * named `<repoName>-<branch>` (e.g. `/code/lobehub` + `feat/x` →
 * `/code/lobehub-feat-x`), matching the convention agents already use for their
 * linked worktrees. Preserves the source path's separator so Windows paths stay
 * intact, and folds ref-illegal characters in the branch to `-` for the folder.
 *
 * Shared by the renderer (path preview + local IPC call) and the server
 * (`device.addGitWorktree`), which re-derives the target from the trusted
 * `path` + `branch` rather than trusting a client-supplied absolute path — so a
 * crafted web request can't ask a remote device to check out at an arbitrary
 * location. Both callers must derive identically, hence the single source here.
 */
const isSep = (ch: string): boolean => ch === '/' || ch === '\\';

export const deriveWorktreePath = (sourcePath: string, branch: string): string => {
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
  while (start < end && folded[start] === '-') start += 1;
  while (end > start && folded[end - 1] === '-') end -= 1;
  const suffix = folded.slice(start, end);
  const folder = suffix ? `${repoName}-${suffix}` : repoName;
  return parent ? `${parent}${sep}${folder}` : folder;
};
