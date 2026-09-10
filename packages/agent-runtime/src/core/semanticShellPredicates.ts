import type { ShellSegment } from './shellCommand';
import { analyzeShellCommand } from './shellCommand';

/**
 * Semantic shell predicates for security rules.
 *
 * Unlike string regex matching on the raw command, these evaluate the PARSED
 * command: segments are split on `;` `&&` `|` respecting quotes, wrappers
 * (sudo/env/nohup) are unwrapped to the real command, and targets are
 * classified (trailing-slash paths, home-resolved paths).
 *
 * Design principle for the security context: over-detection is acceptable,
 * under-detection is not. Quoting must NOT hide danger (`rm '-rf' /` is a real
 * recursive root delete because the shell strips quotes before argv).
 */

/**
 * True when the segment invokes rm with a recursive flag on a target that
 * resolves to the filesystem root '/'.
 */
const isRmRecursiveRootTarget = (segment: ShellSegment): boolean => {
  if (segment.resolvedCommand !== 'rm') return false;
  const recursive = segment.hasFlag('r') || segment.hasFlag('R');
  if (!recursive) return false;
  // Target IS the bare root, or a path that reduces to root ('//' , '/./').
  return segment.trailingSlashTargets.some((target) => /^\/[.:/]*$/.test(target));
};

/**
 * True when the segment invokes rm with a recursive flag on the home
 * directory ITSELF (~, $HOME, /Users/<name>, /home/<name>, with optional
 * trailing slash).
 *
 * Deliberately narrow: recursive deletes INSIDE the home tree (`rm -r
 * ~/notes/old`, `~/.cache`) are routine agent work (dotfile/cleanup) and are
 * covered by the normal approval flow — flagging them would re-create the
 * false-positive problem this module exists to fix.
 */
const isRmRecursiveHomeTarget = (segment: ShellSegment): boolean => {
  if (segment.resolvedCommand !== 'rm') return false;
  const recursive = segment.hasFlag('r') || segment.hasFlag('R');
  if (!recursive) return false;
  // `$HOME/` ends with a slash so it lands in trailingSlashTargets; check both
  // target collections so every home-resolved shape is covered.
  const candidates = [...segment.homeTargets, ...segment.trailingSlashTargets];
  return candidates.some((target) => {
    if (target === '~' || target === '$HOME' || target === '~/') return true;
    if (target === '$HOME/') return true;
    return /^\/(?:Users|home)\/[^/]+\/?$/.test(target);
  });
};

/**
 * True when the segment invokes rm with a recursive flag and force flag on
 * the current directory ('.' / './') — a blanket delete whose blast radius is
 * "whatever cwd happens to be" (the old `rmForceRecursive` rule's intent).
 */
const isRmForceDotTarget = (segment: ShellSegment): boolean => {
  if (segment.resolvedCommand !== 'rm') return false;
  const recursive = segment.hasFlag('r') || segment.hasFlag('R');
  const force = segment.hasFlag('f');
  if (!recursive || !force) return false;
  return segment.trailingSlashTargets.includes('./') || segment.words.slice(1).includes('.');
};

// Extensible registry: future predicates (disk writes, fork bombs, ...) plug in here.
export const SEMANTIC_SHELL_PREDICATE_RESOLVERS: Record<
  string,
  (segment: ShellSegment, segments: ShellSegment[]) => boolean
> = {
  rmRecursiveRootTarget: isRmRecursiveRootTarget,
  rmRecursiveHomeTarget: isRmRecursiveHomeTarget,
  rmForceDotTarget: isRmForceDotTarget,
};

/**
 * Check whether any segment of the command satisfies the named predicate.
 * Unknown predicate names never match (fail-open for forward compatibility —
 * new predicates shipped to a client whose runtime predates them must not
 * flag unrelated commands).
 */
export const matchSemanticShellPredicate = (predicate: string, value: string): boolean => {
  const resolver = SEMANTIC_SHELL_PREDICATE_RESOLVERS[predicate];
  if (!resolver) return false;

  const segments = analyzeShellCommand(value);
  return segments.some((segment) => resolver(segment, segments));
};
