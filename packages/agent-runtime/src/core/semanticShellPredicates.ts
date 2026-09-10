import type { ShellSegment } from './shellCommand';
import { analyzeShellCommand } from './shellCommand';

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

/**
 * Ambiguity fallback (defense in depth).
 *
 * Some wrapper shapes hide the real command from unwrapping: the dangerous
 * `rm` ends up as a wrapper OPTION VALUE whose semantics the resolver cannot
 * know (`env -S 'rm -rf /'`, `bash -c rm -rf /`), or as a POSITIONAL wrapper
 * argument (`timeout 30 rm -rf ~`, `flock /tmp/l rm -rf /`). After
 * unwrapping, resolvedCommand is null/`bash`/`timeout`… — not `rm` — so a
 * plain predicate would pass. Per the module's own principle
 * (over-detection acceptable, under-detection is not), when a segment that
 * did NOT resolve to a confident rm invocation nevertheless CONTAINS an rm
 * word plus a recursive flag plus a dangerous target, treat it as dangerous.
 *
 * The over-detection cost is bounded: this only fires when rm + recursive
 * flag + root/home target co-occur in one segment — a shape that essentially
 * only appears in real attack payloads or adversarial test strings.
 */
const hasAmbiguousRmShape = (segment: ShellSegment): boolean => {
  // Confident rm resolution is handled by the precise predicates; here we
  // catch segments where the command slot is NOT a confidently-parsed rm.
  if (segment.resolvedCommand === 'rm') return false;
  if (segment.resolvedCommand !== null && !AMBIGUOUS_COMMAND_HINTS.has(segment.resolvedCommand)) {
    // Resolved to an unrelated confident command (echo, ls, …) — the rm word
    // (if any) belongs to a quoted string or argument of THAT command; the
    // segment-level fallback would just re-create the original substring
    // false-positive class. Only ambiguous command slots fall through.
    return false;
  }
  const words = segment.words;
  const rmIndex = words.findIndex((word) => word === 'rm' || /\/rm$/.test(word));
  if (rmIndex < 0) {
    // Quoted payload form: the interpreter's -c value arrives as ONE word
    // after quote stripping (`bash -c "rm -rf /"` → word `rm -rf /`). Treat a
    // word that STARTS with `rm ` as an embedded rm invocation.
    return words.some((word) => /^rm\s+(?:-[a-z]+\s+)*/i.test(word) && word.includes('/'));
  }
  const hasRecursiveFlag = segment.flags.some((flag) => /^-[a-z]*r/i.test(flag));
  if (!hasRecursiveFlag) return false;
  // Scan the words AFTER the rm word for a dangerous target. The post-
  // commandIndex target slices are unreliable here precisely because the
  // command slot resolved to null or a wrapper value — that is why this
  // fallback is running at all.
  const hasDangerousTarget = words
    .slice(rmIndex + 1)
    .some(
      (word) =>
        /^\/[.:/]*$/.test(word) ||
        word === './' ||
        ['~', '~/', '$HOME', '$HOME/'].includes(word) ||
        /^\/(?:Users|home)\/[^/]+\/?$/.test(word),
    );
  return hasDangerousTarget;
};

/**
 * Commands whose non-rm resolution still warrants the ambiguous-shape
 * fallback: exec-prefix wrappers whose option/positional value swallowed the
 * real command, and shell interpreters whose -c value IS the payload.
 */
const AMBIGUOUS_COMMAND_HINTS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'timeout',
  'flock',
  'stdbuf',
  'env',
  'xargs',
  'strace',
  'ltrace',
  'setsid',
  'ionice',
]);

/** True when the segment invokes rm with a recursive flag on a target that
 * resolves to the filesystem root '/'. */
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
 *
 * Every rm predicate additionally consults the ambiguous-shape fallback so
 * wrapper-hidden rm payloads (`env -S rm -rf /`, `timeout 30 rm -rf ~`,
 * `bash -c rm -rf /`, `flock /tmp/l rm -rf /`) stay blocked.
 */
export const matchSemanticShellPredicate = (predicate: string, value: string): boolean => {
  const resolver = SEMANTIC_SHELL_PREDICATE_RESOLVERS[predicate];
  if (!resolver) return false;

  const segments = analyzeShellCommand(value);
  return segments.some((segment) => resolver(segment, segments) || hasAmbiguousRmShape(segment));
};
