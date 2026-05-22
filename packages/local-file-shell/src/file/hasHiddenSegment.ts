/**
 * Detect whether a glob pattern (or path) contains a dot-prefixed segment such
 * as `.github`, `.husky`, or `foo/.config`. Used to auto-enable hidden-file
 * matching when the caller's intent is clearly to traverse a hidden directory
 * — otherwise `fast-glob` (`dot: false`) and `ripgrep` (no `--hidden`) silently
 * return zero results.
 *
 * Skips `.` and `..` (relative path indicators), which are not hidden segments.
 */
export const HIDDEN_SEGMENT_RE = /(?:^|\/)\.[^./]/;

export const hasHiddenSegment = (pattern: string | undefined): boolean =>
  !!pattern && HIDDEN_SEGMENT_RE.test(pattern);
