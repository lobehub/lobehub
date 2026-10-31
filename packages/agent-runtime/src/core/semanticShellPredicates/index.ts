import type { SemanticShellPredicate } from '@lobechat/types';

import type { ShellSegment } from '../shellCommand';
import { analyzeShellCommand, parameterExpansionOperand } from '../shellCommand';
import { LITERAL_EXPANSION_MARKER } from '../shellSegmenter';
import { hasAmbiguousRmShape } from './ambiguousShape';
import { collectForwardingRmFunctions, matchesForwardingRmFunction } from './forwardingFunctions';
import { isDotTarget, isHomeTarget, isRootFamilyTarget } from './targets';

/**
 * Semantic shell predicates for security rules.
 *
 * Unlike string regex matching on the raw command, these evaluate the PARSED
 * command: segments are split on `;` `&&` `|` and unescaped newlines,
 * respecting quotes; exec-prefix wrappers (sudo/env/nohup/command/exec/
 * xargs/timeout/…) are unwrapped to the real command; targets are classified
 * (trailing-slash paths, home-resolved paths).
 *
 * Design principle for the security context: over-detection is acceptable,
 * under-detection is not. Quoting must NOT hide danger (`rm '-rf' /` is a real
 * recursive root delete because the shell strips quotes before argv).
 */

/** True when the segment invokes rm with a recursive flag on a target that
 * resolves to the filesystem root '/'. */
const isRmRecursiveRootTarget = (segment: ShellSegment): boolean => {
  if (segment.resolvedCommand !== 'rm') return false;
  const recursive = segment.hasFlag('r') || segment.hasFlag('R');
  if (!recursive) return false;
  // Target IS the bare root, reduces to it ('//', '/./'), or carries a root
  // member inside brace expansion (`{/,/etc}` → '/' and '/etc'). Strictly
  // the ROOT family: '.'/home shapes belong to their own rules — the dot
  // rule additionally demands the force flag, and a root-only custom policy
  // must not fire on them.
  return (
    segment.trailingSlashTargets.some(isRootFamilyTarget) ||
    segment.words.slice(1).some(isRootFamilyTarget)
  );
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
  // Expansion operands (`${D:-~}`) are not home-shaped words themselves, so
  // they land in neither target collection; check them explicitly.
  const expansions = segment.words
    .slice(1)
    .filter((word) => parameterExpansionOperand(word) !== undefined);
  return [...segment.homeTargets, ...segment.trailingSlashTargets, ...expansions].some(
    isHomeTarget,
  );
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
  return segment.trailingSlashTargets.includes('./') || segment.words.slice(1).some(isDotTarget);
};

// Extensible registry: future predicates (disk writes, fork bombs, ...) plug
// in here. Keyed by SemanticShellPredicate so adding a predicate to the types
// union without registering a resolver is a compile error, not a silent
// runtime fail-open.
export const SEMANTIC_SHELL_PREDICATE_RESOLVERS: Record<
  SemanticShellPredicate,
  (segment: ShellSegment, segments: ShellSegment[]) => boolean
> = {
  rmRecursiveRootTarget: isRmRecursiveRootTarget,
  rmRecursiveHomeTarget: isRmRecursiveHomeTarget,
  rmForceDotTarget: isRmForceDotTarget,
};

/**
 * Known-predicate guard.
 *
 * `matchSemanticShellPredicate` keeps a `string` parameter on purpose: a config
 * carrying a predicate name newer than this runtime must fail open rather than
 * flag unrelated commands. That deliberate looseness is exactly why the record
 * cannot be indexed directly — this guard narrows the type after the runtime
 * lookup, so the fail-open behaviour and the `Record<SemanticShellPredicate, …>`
 * index type are both satisfied.
 */
const isKnownPredicate = (predicate: string): predicate is SemanticShellPredicate =>
  Object.prototype.hasOwnProperty.call(SEMANTIC_SHELL_PREDICATE_RESOLVERS, predicate);

/**
 * Check whether any segment of the command satisfies the named predicate.
 * Unknown predicate names never match (fail-open for forward compatibility —
 * new predicates shipped to a client whose runtime predates them must not
 * flag unrelated commands).
 *
 * Every rm predicate additionally consults the ambiguous-shape fallback so
 * wrapper-hidden rm payloads (`env -S rm -rf /`, `timeout 30 rm -rf ~`,
 * `bash -c rm -rf /`, `flock /tmp/l rm -rf /`) stay blocked.
 */
export const matchSemanticShellPredicate = (predicate: string, value: string): boolean => {
  if (!isKnownPredicate(predicate)) return false;
  const requested = predicate;
  const resolver = SEMANTIC_SHELL_PREDICATE_RESOLVERS[predicate];

  // The literal-expansion marker is generated BY the segmenter, so caller text
  // must not be able to forge it: a real U+0001 before a substitution
  // (`echo \u0001$(rm -rf ~)`) was read as the marker, the substitution was
  // treated as inert text, the predicate returned false and intervention became
  // `never` although Bash ran the deletion. Drop every marker byte from the
  // input before parsing; the segmenter re-adds its own, and removing a control
  // character only makes the analysis stricter.
  const segments = analyzeShellCommand(value.replaceAll(LITERAL_EXPANSION_MARKER, ''));
  // Shell-function definitions live in their own segments; collect them once
  // so a later invocation of a forwarding function is judged as the rm call
  // it really is.
  const forwardingRmFunctions = collectForwardingRmFunctions(segments);
  return segments.some(
    (segment) =>
      resolver(segment, segments) ||
      hasAmbiguousRmShape(segment, 0, requested) ||
      matchesForwardingRmFunction(segment, requested, forwardingRmFunctions),
  );
};
