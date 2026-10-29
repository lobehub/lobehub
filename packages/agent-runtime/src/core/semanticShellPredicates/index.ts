import type { SemanticShellPredicate } from '@lobechat/types';

import type { ShellSegment } from '../shellCommand';
import {
  analyzeShellCommand,
  collectFlagLettersAndNames,
  isUnresolvableCommandWord,
  parameterExpansionOperand,
} from '../shellCommand';
import { stripGroupingParens } from '../shellQuoting';
import { LITERAL_EXPANSION_MARKER } from '../shellSegmenter';

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

/** Root-family targets: bare '/', root-reducible shapes and root globs.
 * Deliberately DISJOINT from the home/dot families — the precise root
 * resolver and the scoped fallback both must not fire on '.'/home shapes
 * that belong to their own rules (mislabeling breaks custom matcher
 * contracts and reports the wrong warning).
 *
 * Parent traversal is resolved first: an operand like /tmp/.. then a glob
 * member expands to the directories directly below root and recursively
 * deletes them, so the operand must be normalized to root before the glob
 * test — rejecting it because of the real tmp component would leak the
 * bypass.
 */
/**
 * Lift a family test over parameter expansions: `${Y:-/}` deletes `/` when Y
 * is unset, so an operand of that shape matches when any word of its
 * expansion operand matches (unquoted, the operand is word-split).
 */
const withExpansionOperand =
  (test: (word: string) => boolean) =>
  (word: string): boolean => {
    if (test(word)) return true;
    const operand = parameterExpansionOperand(word);
    return operand !== undefined && operand.split(/\s+/).some((member) => test(member));
  };

/** A component that expands to more than one name: `*`, `?`, `[...]`. */
const hasGlobMeta = (component: string): boolean => /[*?[]/.test(component);

/**
 * A glob component directly under root that expands to essentially the whole
 * top level: `*`, `**`, `?`, `?*`, `[a-z]*`, `.*`. Narrowing the expansion
 * with a literal name (`*.log`, `tmp*`) keeps it a subset delete and out of
 * the root family.
 */
const isRootWideGlobComponent = (component: string): boolean => {
  if (!hasGlobMeta(component)) return false;
  // Drop character classes and single-character wildcards: a remainder that is
  // empty (or only dots/colons) means no literal name narrowed the expansion.
  const remainder = component.replaceAll(/\[[^\]]*\]/g, '').replaceAll(/[*?]/g, '');
  return /^[.:]*$/.test(remainder);
};

/**
 * Root-family target: the operand IS root, normalizes to root, or is a single
 * root-wide glob directly under root (`/` + `*`, `/` + `?*`, `/` + `[a-z]*`).
 * Such an expansion covers the top-level entries and `rm -rf` deletes them
 * all.
 *
 * `segment/..` pairs and `/.` are normalized FIRST: the parent-traversal form
 * `rm -rf /tmp/../*` must be judged as a root-wide glob, not rejected because
 * of the real `tmp` component. A glob behind a real component (`/tmp` + `/*`)
 * is a subset delete.
 */
const isRootFamilyTargetLiteral = (word: string): boolean => {
  // A grouping paren can glue to the operand (`(rm -rf /)` tokenizes the
  // target as `/)`): `(`/`)` are shell operators, not part of the path.
  const operand = stripGroupingParens(word);
  if (operand.startsWith('{') && operand.endsWith('}')) {
    // Brace expansion (`{/,/etc}` → '/' and '/etc'): dangerous when any
    // member is a root-family shape.
    return operand
      .slice(1, -1)
      .split(',')
      .some((member) => isRootFamilyTargetLiteral(member));
  }
  if (!operand.startsWith('/')) return false;
  const parts = operand
    .replaceAll(/\/\.(?=\/|$)/g, '')
    .split('/')
    .reduce<string[]>((stack, part) => {
      // `..` at root stays at root (`/..` IS `/`): popping an empty stack is
      // a no-op, never a pushed `..` component.
      if (part === '..') stack.pop();
      else if (part !== '' && part !== '.') stack.push(part);
      return stack;
    }, []);
  if (parts.length === 0) return true; // '/', '//', '/.', '/./' …
  return parts.length === 1 && isRootWideGlobComponent(parts[0]);
};

const isRootFamilyTarget = withExpansionOperand(isRootFamilyTargetLiteral);

/** Home-directory targets: ~, $HOME, /Users/<name>, /home/<name> (optional
 * trailing slash). Shared by the precise predicate and the scoped fallback.
 * Grouping parens are stripped first: `(rm -rf ~)` leaves the operand as `~)`,
 * and only the root family used to normalize that operator away. */
const isHomeTarget = withExpansionOperand((word: string): boolean => {
  const operand = stripGroupingParens(word);
  return (
    operand === '~' ||
    operand === '$HOME' ||
    operand === '${HOME}' ||
    operand === '~/' ||
    operand === '$HOME/' ||
    operand === '${HOME}/' ||
    /^\/(?:Users|home)\/[^/]+\/?$/.test(operand)
  );
});

/** Current-directory targets: '.' and './'. */
const isDotTarget = withExpansionOperand((word: string): boolean => {
  const operand = stripGroupingParens(word);
  return operand === '.' || operand === './';
});

/**
 * Per-predicate target families for the ambiguity fallback. The fallback
 * must honour the REQUESTED predicate's semantics — a home-scoped matcher
 * must not fire on a root-shaped payload (`bash -c "rm -rf /"` under
 * rmRecursiveHomeTarget), or the reported rule mislabels the danger and
 * custom matcher contracts break.
 */
const TARGET_FAMILY_TESTS: Record<SemanticShellPredicate, (word: string) => boolean> = {
  rmRecursiveRootTarget: isRootFamilyTarget,
  rmRecursiveHomeTarget: isHomeTarget,
  rmForceDotTarget: isDotTarget,
};

/** rm + recursive flag + a target from the predicate's family. */
const hasRecursiveRmWithDangerousTarget = (
  segment: ShellSegment,
  predicate: SemanticShellPredicate,
): boolean => {
  const recursive = segment.hasFlag('r') || segment.hasFlag('R');
  if (!recursive) return false;
  // rmForceDotTarget's precise contract also requires the force flag.
  if (predicate === 'rmForceDotTarget' && !segment.hasFlag('f')) return false;
  const familyTest = TARGET_FAMILY_TESTS[predicate];
  // words.slice(1) supplements the target slices: root-reducible shapes like
  // '/.' and brace words '{/,/etc}' carry no trailing slash, and the slice
  // keeps matching robust when the command slot is ambiguous.
  return [...segment.trailingSlashTargets, ...segment.homeTargets, ...segment.words.slice(1)].some(
    familyTest,
  );
};

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
 * Command substitutions execute BEFORE the surrounding command, so a confident
 * outer command says nothing about them: `echo $(rm -rf ~)` deletes the home
 * directory and then echoes the empty result. The outer words themselves are
 * still safe to ignore — a literal `rm -rf ~` inside a quoted argument is data,
 * not a command — so only the bodies of `$( … )` and backtick substitutions are
 * extracted here and re-analyzed as payloads.
 */
/**
 * Whether the sigil at `index` is marked as literal text (single quotes or a
 * backslash suppressed its expansion). The segmenter writes the marker right
 * before the sigil.
 */
const isLiteralExpansionAt = (text: string, index: number): boolean =>
  index > 0 && text[index - 1] === LITERAL_EXPANSION_MARKER;

/**
 * Shells that execute one of their arguments as NEW shell source (`bash -c '…'`,
 * `eval '…'`), including when the interpreter sits behind another wrapper
 * (`xargs bash -c '…'`). Quote provenance from the calling shell stops at that
 * boundary, so the markers the tokenizer wrote for the CALLER's quotes must be
 * dropped before the payload is re-parsed: `bash -c 'echo $(rm -rf ~)'` still
 * runs the substitution in the child shell.
 */
const SHELL_INTERPRETER_COMMANDS = new Set(['bash', 'dash', 'eval', 'ksh', 'sh', 'zsh']);

const isShellInterpreterWord = (word: string): boolean =>
  SHELL_INTERPRETER_COMMANDS.has(word.replace(/^.*\//, ''));

/** Drop literal-expansion markers: the payload is a fresh shell level. */
const withoutLiteralMarkers = (word: string): string =>
  word.includes(LITERAL_EXPANSION_MARKER) ? word.split(LITERAL_EXPANSION_MARKER).join('') : word;

const substitutionPayloads = (word: string): string[] => {
  const payloads: string[] = [];
  for (let index = 0; index < word.length; index++) {
    if (word[index] === '$' && word[index + 1] === '(') {
      // A literal, non-expanding sigil — never a substitution.
      if (isLiteralExpansionAt(word, index)) continue;
      // `$((…))` is arithmetic, not a command substitution.
      if (word[index + 2] === '(') continue;
      let depth = 0;
      let body: string | undefined;
      for (let cursor = index + 1; cursor < word.length; cursor++) {
        if (word[cursor] === '(') depth++;
        else if (word[cursor] === ')' && --depth === 0) {
          body = word.slice(index + 2, cursor);
          index = cursor;
          break;
        }
      }
      // Quoting provenance is gone by now (the tokenizer strips quotes), so a
      // parenthesis that was QUOTED arrives as a bare one and the depth counter
      // either never closes (`echo $(printf "("; rm -rf ~)`) or closes on the
      // wrong paren (`echo $(printf ")"; rm -rf ~)`). Re-analyze the whole
      // remainder as a payload in both cases instead of trusting the split:
      // the executed command is still in there, merely with a stray paren.
      const tail = word.slice(index + 2).replace(/\)$/, '');
      for (const candidate of [body, tail]) {
        if (candidate && candidate.trim() && !payloads.includes(candidate))
          payloads.push(candidate);
      }
      continue;
    }
    if (word[index] === '`') {
      // Same provenance rule: `'\` … \`'` inside single quotes is literal text.
      if (isLiteralExpansionAt(word, index)) continue;
      const end = word.indexOf('`', index + 1);
      if (end < 0) continue;
      payloads.push(word.slice(index + 1, end));
      index = end;
    }
  }
  return payloads;
};

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
 * Payload words the segment hands to a NEW shell level as source: the word
 * after `-c` (`bash -c '<payload>'`, combined flags like `-ec '<payload>'`
 * included) and, for `eval`, every following argument — Bash joins them with
 * spaces before executing the result (`help eval`: "Combine ARGs into a single
 * string").
 *
 * Both shapes must be analyzed whatever ELSE the segment contains:
 *  - a positional `rm` in `bash -c 'echo $(rm -rf ~)' rm` used to divert the
 *    fallback into its bare-rm branch and skip the payload inspection; and
 *  - reparsing `eval 'rm -rf' ~` argument by argument split the command from
 *    its target, so neither half looked dangerous on its own.
 */
/**
 * Long interpreter options that take their value as the NEXT word
 * (`bash --rcfile FILE`, `bash --init-file FILE`). Long options written as
 * `--opt=value` carry the operand inline and are skipped as a single word.
 */
const INTERPRETER_LONG_OPTIONS_WITH_VALUE = new Set(['--init-file', '--rcfile']);

const interpreterPayloadWords = (segment: ShellSegment): string[] => {
  const words = segment.words;
  const payloads: string[] = [];
  for (let index = 0; index < words.length; index++) {
    if (!isShellInterpreterWord(words[index])) continue;
    if (words[index].replace(/^.*\//, '') === 'eval') {
      // `eval` concatenates its arguments; `eval 'rm -rf' ~` runs `rm -rf ~`.
      const joined = words
        .slice(index + 1)
        .join(' ')
        .trim();
      if (joined) payloads.push(joined);
      continue;
    }
    // Walk the interpreter's option words: `bash -e -c '<payload>'` puts the
    // command payload after any number of preceding options (`bash [GNU long
    // option] [option] ...`), so requiring `-c` right after the executable
    // missed the payload and let the deletion run in the child shell.
    //
    // The walk models Bash's own parse instead of the shape of one word:
    //  - `c` sets a PENDING command and may sit anywhere in a cluster (`-c`,
    //    `-ec`, `-xce`), so the payload is the first NON-OPTION word after it;
    //  - `+`-prefixed words stay option words (`bash +e -c '…'`; `help set`:
    //    "Using + rather than - causes these flags to be turned off"), so they
    //    must not end the walk;
    //  - `-o option` / `-O shopt_option` take their operand from the NEXT word
    //    and a cluster can carry both (`bash -xoc pipefail -c '<payload>'`), so
    //    each such letter before `c` shifts where the payload starts.
    let cursor = index + 1;
    let commandPending = false;
    while (cursor < words.length) {
      const option = words[cursor];
      if (option === '--') {
        // End of options: a pending `-c` takes the next word as its payload.
        if (commandPending && words[cursor + 1]) payloads.push(words[cursor + 1]);
        break;
      }
      if (option.startsWith('+')) {
        // `+`-prefixed options still take their operand from the NEXT word:
        // `help set` documents `-o option-name` and says "Using + rather than -
        // causes these flags to be turned off", so `bash +o posix -c '<src>'`
        // skips `+o` but leaves `posix`, and the walk stopped before `-c` — the
        // positional `rm` in `bash +o posix -c 'echo $(rm -rf ~)' rm` then
        // suppressed the fallback and all three predicates returned false.
        const plusLetters = option.slice(1);
        cursor += 1 + [...plusLetters].filter((letter) => /o/i.test(letter)).length;
        continue;
      }
      if (!option.startsWith('-')) {
        // First non-option word: the pending `-c` payload (`bash -c '<src>'`,
        // `bash -xce '<src>'`) or the script file of a plain `bash script.sh`.
        if (commandPending) payloads.push(option);
        break;
      }
      if (option.startsWith('--')) {
        // Value-taking long options (`bash --rcfile FILE -c …`) keep their
        // operand in the NEXT word. Skipping only the flag made the operand
        // look like the end of the option list (`FILE` does not start with
        // `-`), so the walk broke before `-c` and the payload stayed invisible.
        cursor += INTERPRETER_LONG_OPTIONS_WITH_VALUE.has(option) ? 2 : 1;
        continue;
      }
      const letters = option.slice(1);
      const commandAt = letters.indexOf('c');
      if (commandAt === 0 && letters.length > 1) {
        // Glued form `-c<source>`: keep the remainder as a candidate so a
        // command written without a space is still inspected. Over-detection is
        // the safe direction: `bash -cecho hi` makes `echo` more flags and `hi`
        // the `-o` operand (`bash: hi: invalid option name`), never source.
        payloads.push(letters.slice(1));
      }
      if (commandAt !== -1) commandPending = true;
      // Operand letters before `c` consume the next word, which moves the
      // payload: `bash -xoc pipefail -c '<payload>'` runs `<payload>`, not
      // `pipefail`, and all three predicates returned false for it.
      const operandLetters = commandAt === -1 ? letters : letters.slice(0, commandAt);
      const operands = [...operandLetters].filter((letter) => /o/i.test(letter)).length;
      cursor += 1 + operands;
    }
  }
  return payloads;
};

const hasAmbiguousRmShape = (
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
]);

/** A token that forwards the caller's whole argv into the callee's argv. */
const ARG_FORWARD_PATTERN = /^\$(?:@|\*|\{@\}|\{\*\})$/;

/** A forwarding shell function whose body forwards argv into `rm`. */
interface ForwardingRmFunction {
  /** The body itself carries a force flag (`rm -rf "$@"`). */
  force: boolean;
  /** The body itself carries a recursive flag (`rm -rf "$@"`). */
  recursive: boolean;
}

/**
 * Parse a Bash function definition head (`zap(){ … }`, `zap() { … }`,
 * `function zap { … }`, `function zap() { … }`) into its name and body words.
 * Returns null when the segment is not a definition.
 */
const parseFunctionDefinition = (words: string[]): { body: string[]; name: string } | null => {
  const [first] = words;
  if (!first) return null;

  if (first === 'function') {
    const name = (words[1] ?? '').replace(/\(\s*\)$/, '');
    if (!/^[a-z_][\w-]*$/i.test(name)) return null;
    return { body: words.slice(words[2] === '{' ? 3 : 2), name };
  }

  const withParens = /^([a-z_][\w-]*)\s*\(\s*\)\s*\{?$/i.exec(first);
  if (withParens) {
    const name = withParens[1];
    if (first.endsWith('{')) return { body: words.slice(1), name };
    return words[1] === '{' ? { body: words.slice(2), name } : null;
  }

  // Whitespace between the name and `()` (`zap () { … }`) tokenizes them apart.
  if (/^[a-z_][\w-]*$/i.test(first)) {
    let index = 1;
    if (words[index] === '()') index++;
    if (words[index] === '{') return { body: words.slice(index + 1), name: first };
  }

  return null;
};

/**
 * Shell functions that forward the caller's argv into `rm` (`zap(){ rm "$@"; }`).
 *
 * Calling such a function (`zap -rf /`) deletes root exactly like `rm -rf /`,
 * but the definition and the invocation are separate segments and the
 * invocation resolves to the FUNCTION name, not `rm` — the precise predicates
 * and the ambiguity fallback both skip it. The flags may sit in either place
 * (`rm -rf "$@"` vs `zap -rf /`), so both are collected.
 */
const collectForwardingRmFunctions = (
  segments: ShellSegment[],
): Map<string, ForwardingRmFunction> => {
  const functions = new Map<string, ForwardingRmFunction>();
  for (const segment of segments) {
    const definition = parseFunctionDefinition(segment.words);
    if (!definition) continue;
    const { body, name } = definition;
    const rmIndex = body.findIndex((word) => word === 'rm' || /\/rm$/.test(word));
    if (rmIndex < 0) continue;
    // Only argv-forwarding bodies receive the caller's target and flags; a
    // body that names its own target (`rm -rf /tmp/x "$@"`) is not covered
    // here and stays with the precise predicates on its own segment.
    if (!body.slice(rmIndex + 1).some((word) => ARG_FORWARD_PATTERN.test(word))) continue;
    const { letters, names } = collectFlagLettersAndNames(
      body.slice(rmIndex + 1).filter((word) => word.startsWith('-') && word.length > 1),
    );
    functions.set(name, {
      force: letters.has('f') || names.has('force'),
      recursive: letters.has('r') || letters.has('R') || names.has('recursive'),
    });
  }
  return functions;
};

/**
 * True when the segment invokes a forwarding function as if it were `rm`:
 * recursive flag (from the call, the body, or both) plus a target from the
 * REQUESTED predicate's family. Honours the predicate contract exactly like
 * the precise resolvers, including the force requirement of the dot rule.
 */
const matchesForwardingRmFunction = (
  segment: ShellSegment,
  predicate: SemanticShellPredicate,
  functions: Map<string, ForwardingRmFunction>,
): boolean => {
  const functionName = segment.resolvedCommand;
  if (!functionName) return false;
  const body = functions.get(functionName);
  if (!body) return false;

  const { letters, names } = collectFlagLettersAndNames(segment.flags);
  const recursive =
    body.recursive || letters.has('r') || letters.has('R') || names.has('recursive');
  if (!recursive) return false;

  const force = body.force || letters.has('f') || names.has('force');
  if (predicate === 'rmForceDotTarget' && !force) return false;

  return segment.words.slice(1).some(TARGET_FAMILY_TESTS[predicate]);
};

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
