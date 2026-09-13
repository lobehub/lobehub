import type { SemanticShellPredicate } from '@lobechat/types';

import type { ShellSegment } from './shellCommand';
import { analyzeShellCommand, collectFlagLettersAndNames } from './shellCommand';

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
/**
 * Interpreter payloads (bash -c '…', env -S'…') arrive as ONE word after
 * quote stripping. Re-analyze the payload with the same parser and apply the
 * same predicate — the embedded command gets real segmentation instead of a
 * brittle prefix regex. This catches prefixed payloads (`cd / && rm -rf /`)
 * and closes the over-detection the old prefix regex caused: a payload whose
 * parsed segments are NOT dangerous (`rm -rf /tmp/build-cache` → home/root
 * predicates false) no longer matches merely because the word starts with
 * "rm" and contains a slash.
 */
const DANGEROUS_TARGET_TESTS = [
  // Root: bare '/', or a path that reduces to it ('//', '/.', '/./', trailing
  // slashes) — every component is dots/slashes.
  (word: string) => /^\/[.:/]*$/.test(word),
  (word: string) => word === './' || word === '.',
  (word: string) => ['~', '~/', '$HOME', '$HOME/'].includes(word),
  (word: string) => /^\/(?:Users|home)\/[^/]+\/?$/.test(word),
];

/**
 * Classify a target word as dangerous. Handles brace expansion (`{/,/etc}`
 * expands to '/' and '/etc'); the tokenizer cannot know whether the shell
 * will expand it, and per the module principle a possible root delete must
 * not slip through (over-detection is acceptable).
 */
const isDangerousTarget = (word: string): boolean => {
  if (DANGEROUS_TARGET_TESTS.some((test) => test(word))) return true;
  if (word.startsWith('{') && word.endsWith('}')) {
    return word
      .slice(1, -1)
      .split(',')
      .some((member) => DANGEROUS_TARGET_TESTS.some((test) => test(member)));
  }
  return false;
};

/** rm + recursive flag + a dangerous target among the segment's words. */
const hasRecursiveRmWithDangerousTarget = (segment: ShellSegment): boolean => {
  const recursive = segment.hasFlag('r') || segment.hasFlag('R');
  if (!recursive) return false;
  // words.slice(1) supplements the target slices: root-reducible shapes like
  // '/.' and brace words '{/,/etc}' carry no trailing slash, and the slice
  // keeps matching robust when the command slot is ambiguous.
  return [...segment.trailingSlashTargets, ...segment.homeTargets, ...segment.words.slice(1)].some(
    isDangerousTarget,
  );
};

/**
 * Interpreter payloads (bash -c '…', env -S'…') arrive as ONE word after
 * quote stripping. Re-analyze the payload with the same parser and apply the
 * same predicates — the embedded command gets real segmentation instead of a
 * brittle prefix regex. This catches prefixed payloads (`cd / && rm -rf /`)
 * and closes the over-detection the old prefix regex caused: a payload whose
 * parsed segments are NOT dangerous (`rm -rf /tmp/build-cache`) no longer
 * matches merely because the word starts with "rm" and contains a slash.
 *
 * Depth-bounded: a word re-parses to segments whose words re-enter here;
 * the guard terminates pathological self-similar shapes.
 */
const payloadIsDangerous = (word: string, depth: number): boolean => {
  if (depth > 2) return false;
  // A glued short-flag+value token (`-Srm -rf /` from `env -S'rm -rf /'`)
  // buries the payload after the flag letter; also try the un-glued tail.
  const candidates = word.startsWith('-') && word.length > 2 ? [word, word.slice(2)] : [word];
  return candidates.some((candidate) =>
    analyzeShellCommand(candidate).some((segment) => {
      if (segment.resolvedCommand === 'rm') return hasRecursiveRmWithDangerousTarget(segment);
      return hasAmbiguousRmShape(segment, depth + 1);
    }),
  );
};

const hasAmbiguousRmShape = (segment: ShellSegment, depth = 0): boolean => {
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
    // after quote stripping (`bash -c "rm -rf /"` → word `rm -rf /`). Parse
    // the payload instead of pattern-guessing its shape.
    return words.some((word) => payloadIsDangerous(word, depth));
  }
  // Recursive flag detection shared with the precise predicates: long names
  // (--recursive) and combined short flags (-rf) both count.
  const { letters, names } = collectFlagLettersAndNames(segment.flags);
  if (!letters.has('r') && !names.has('recursive')) return false;
  // Scan the words AFTER the rm word for a dangerous target. The post-
  // commandIndex target slices are unreliable here precisely because the
  // command slot resolved to null or a wrapper value — that is why this
  // fallback is running at all.
  return words.slice(rmIndex + 1).some(isDangerousTarget);
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
  // Target IS the bare root, reduces to it ('//', '/.', '/./'), or carries a
  // root member inside brace expansion (`{/,/etc}` → '/' and '/etc').
  return (
    segment.trailingSlashTargets.some(isDangerousTarget) ||
    segment.words.slice(1).some(isDangerousTarget)
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
  const candidates = [...segment.homeTargets, ...segment.trailingSlashTargets];
  return candidates.some(
    (target) =>
      target === '~' ||
      target === '$HOME' ||
      target === '~/' ||
      target === '$HOME/' ||
      /^\/(?:Users|home)\/[^/]+\/?$/.test(target),
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
  return segment.trailingSlashTargets.includes('./') || segment.words.slice(1).includes('.');
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
