import type { SemanticShellPredicate } from '@lobechat/types';

import type { ShellSegment } from '../shellCommand';
import {
  analyzeShellCommand,
  collectFlagLettersAndNames,
  isUnresolvableCommandWord,
  parameterExpansionOperand,
} from '../shellCommand';
import {
  inlineCommandOptionPayload,
  interpreterPayloadWords,
  isShellInterpreterWord,
  substitutionPayloads,
  withoutLiteralMarkers,
} from './payloadWords';
import { hasRecursiveRmWithDangerousTarget, TARGET_FAMILY_TESTS } from './targets';

const MAX_PAYLOAD_DEPTH = 2;

/**
 * Past the payload depth limit the leftover source still runs, so reporting it
 * as safe would clear a `$( … $(rm -rf ~) … )` chain that Bash happily
 * executes. Flatten the remaining substitution syntax into plain argv and judge
 * every `rm` still visible: the depth cap then costs precision, never
 * detection.
 */
const deepPayloadIsDangerous = (word: string, predicate: SemanticShellPredicate): boolean => {
  const tokens = word.replaceAll('$(', ' ').replaceAll(/[)`]/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.some((token, index) => {
    if (token !== 'rm') return false;
    return analyzeShellCommand(tokens.slice(index).join(' ')).some(
      (segment) =>
        segment.resolvedCommand === 'rm' && hasRecursiveRmWithDangerousTarget(segment, predicate),
    );
  });
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
const payloadIsDangerous = (
  word: string,
  depth: number,
  predicate: SemanticShellPredicate,
): boolean => {
  if (depth > MAX_PAYLOAD_DEPTH) return deepPayloadIsDangerous(word, predicate);
  // A glued short-flag+value token (`-Srm -rf /` from `env -S'rm -rf /'`)
  // buries the payload after the flag letter; also try the un-glued tail.
  const candidates = word.startsWith('-') && word.length > 2 ? [word, word.slice(2)] : [word];
  // `su --command='rm -rf ~'` keeps the command glued to the option name, so
  // the word itself parses as the flag `--command=rm` and the payload is only
  // reachable through the `=` split.
  const inlinePayload = inlineCommandOptionPayload(word);
  if (inlinePayload !== undefined) candidates.push(inlinePayload);
  // `${X:-rm -rf /}` in the command slot word-splits its operand into the
  // executed argv: re-parse the operand as a payload too.
  const operand = parameterExpansionOperand(word);
  if (operand !== undefined) candidates.push(operand);
  return candidates.some((candidate) =>
    analyzeShellCommand(candidate).some((segment) => {
      if (segment.resolvedCommand === 'rm') {
        // The precise predicates read only the LEVEL of argv they resolve to:
        // in `echo $(rm -f $(rm -rf ~))` the reparsed payload resolves to `rm`
        // with the nonrecursive `-f`, and the inner substitution — which runs
        // first and does carry `-rf ~` — sits inside an operand word. Inspect
        // those bodies too instead of returning early on the outer flags.
        if (hasRecursiveRmWithDangerousTarget(segment, predicate)) return true;
        return segment.words.some((word) =>
          substitutionPayloads(word).some((payload) =>
            payloadIsDangerous(payload, depth + 1, predicate),
          ),
        );
      }
      return hasAmbiguousRmShape(segment, depth + 1, predicate);
    }),
  );
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
  // `coproc [NAME] command [redirections]` executes command asynchronously.
  // NAME is optional, so the word after `coproc` is either the name or the
  // command and is not statically separable — treat the whole segment
  // conservatively (rm word + recursive flag + family target) rather than
  // trusting the word after `coproc` as the command.
  'coproc',
  // `eval` string-concatenates its arguments and executes the result as a
  // shell command: `eval rm -rf /` runs rm, and the combined arguments can
  // hide compound payloads (`eval "cd / && rm -rf /"`). Both shapes reach the
  // fallback below — bare rm words via the rm-word scan, quoted payloads via
  // the re-parse branch — exactly like the other interpreters in this set.
  'eval',
  'timeout',
  'flock',
  'stdbuf',
  'env',
  'xargs',
  'strace',
  'ltrace',
  'setsid',
  'ionice',
  // runuser resolves to null on the `--` form (end-of-options marker stops
  // the unwrap loop before the command word), so the ambiguity fallback must
  // cover its segments.
  'runuser',
  // `su` is a privilege switch, not an exec prefix: `su -c 'rm -rf ~'` resolves
  // confidently to `su` while the delete runs in the target user's shell, so
  // the `-c/--command` value has to be re-parsed here. The `-s` shell path and
  // the optional trailing user keep the unwrap loop from ever reaching the
  // payload, which is why this set — not the resolver — owns the shape.
  'su',
]);

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

export const hasAmbiguousRmShape = (
  segment: ShellSegment,
  depth = 0,
  predicate: SemanticShellPredicate,
): boolean => {
  // Confident rm resolution is handled by the precise predicates; here we
  // catch segments where the command slot is NOT a confidently-parsed rm.
  // A resolved rm still needs its substitutions inspected: in
  // `rm -f $(rm -rf ~)` the precise predicates see only the OUTER `-f`, while
  // the substitution deletes the home directory before the outer rm runs.
  if (segment.resolvedCommand === 'rm') {
    return segment.words.some((word) =>
      substitutionPayloads(word).some((payload) => payloadIsDangerous(payload, depth, predicate)),
    );
  }
  if (segment.resolvedCommand !== null && !AMBIGUOUS_COMMAND_HINTS.has(segment.resolvedCommand)) {
    // Resolved to an unrelated confident command (echo, ls, …) — a bare `rm`
    // word in this segment belongs to a quoted string or argument of THAT
    // command, and scanning words would re-create the original substring
    // false-positive class. Command substitutions are the exception: their
    // bodies run first, whatever the outer command is.
    return segment.words.some((word) =>
      substitutionPayloads(word).some((payload) => payloadIsDangerous(payload, depth, predicate)),
    );
  }
  const words = segment.words;
  // A shell interpreter runs its payload as fresh shell source, so the payload
  // is analyzed regardless of any bare `rm` word sitting in this segment: in
  // `bash -c 'echo $(rm -rf ~)' rm` the positional `rm` used to short-circuit
  // this fallback before the payload was ever inspected.
  if (
    interpreterPayloadWords(segment).some((payload) =>
      payloadIsDangerous(withoutLiteralMarkers(payload), depth, predicate),
    )
  ) {
    return true;
  }
  // Executable substitutions in this segment run in the CALLING shell, before
  // the command itself — including when that command is an interpreter whose
  // payload was just analyzed: in `bash -c : "$(rm -rf ~)"` the substitution is
  // an argument to bash and expands in the current shell, not inside the child.
  if (
    words.some((word) =>
      substitutionPayloads(word).some((payload) => payloadIsDangerous(payload, depth, predicate)),
    )
  ) {
    return true;
  }
  const rmIndex = words.findIndex((word) => word === 'rm' || /\/rm$/.test(word));
  if (rmIndex < 0) {
    // The executable is unknowable at parse time: command substitution
    // ($(printf rm) -rf ~, `printf rm` -rf ~) or parameter expansion of any
    // shape (X=rm; $X -rf /, ${CMD:-rm} -rf /, sudo ${CMD}rm -rf /). No rm
    // word exists in the segment, and per the module principle an
    // unresolvable argv[0] next to a recursive flag + a family target must
    // not pass. The command slot may sit behind a wrapper (sudo/timeout …),
    // so any unresolvable word in an ambiguous segment counts.
    const hasUnresolvableWord = words.some(
      (word) => !/^\d+$/.test(word) && isUnresolvableCommandWord(word),
    );
    if (hasUnresolvableWord) {
      const { letters, names } = collectFlagLettersAndNames(segment.flags);
      if (
        (letters.has('r') || names.has('recursive')) &&
        words.slice(1).some(TARGET_FAMILY_TESTS[predicate])
      ) {
        return true;
      }
    }
    // Quoted payload form: the interpreter's -c value arrives as ONE word
    // after quote stripping (`bash -c "rm -rf /"` → word `rm -rf /`). Parse
    // the payload instead of pattern-guessing its shape — this also covers
    // an expansion whose operand is the whole command (`${X:-rm -rf /}`).
    //
    // The caller's quoting provenance does NOT cross an interpreter boundary:
    // in `bash -c 'echo $(rm -rf ~)'` the single quotes only suppress expansion
    // in the CALLING shell, while the child shell runs the substitution. Clear
    // the markers before the re-parse so quoting cannot launder a real
    // substitution into literal text.
    const freshSource = words.some((word) => isShellInterpreterWord(word));
    return words.some((word) =>
      payloadIsDangerous(freshSource ? withoutLiteralMarkers(word) : word, depth, predicate),
    );
  }
  // Recursive flag detection shared with the precise predicates: long names
  // (--recursive) and combined short flags (-rf) both count.
  const { letters, names } = collectFlagLettersAndNames(segment.flags);
  if (!letters.has('r') && !names.has('recursive')) return false;
  // Scan the words AFTER the rm word for a target from the REQUESTED
  // predicate's family — the fallback honours which rule is being asked,
  // so a home matcher stays silent on root-shaped payloads and vice versa.
  return words.slice(rmIndex + 1).some(TARGET_FAMILY_TESTS[predicate]);
};
