import { describe, expect, it } from 'vitest';

import { matchSemanticShellPredicate } from './semanticShellPredicates';

/**
 * Payloads that cross a shell boundary: substitution bodies, caller-level
 * expansions, `eval` argument joins, interpreter option operands and heredoc
 * input. Each one runs as NEW shell source or expands before the outer command
 * runs, so the calling shell's quoting and quote provenance stop at the
 * boundary and the payload has to be analyzed on its own.
 */
describe('matchSemanticShellPredicate · interpreter payloads', () => {
  describe('command substitution containment', () => {
    // Substitution bodies stay embedded inside words rather than splitting the
    // outer command. They still RUN before the outer command, so a confident
    // `echo` says nothing about them: `echo $(rm -rf ~)` deletes the home
    // directory first. The predicates therefore analyze substitution payloads
    // instead of trusting the outer command; literal words of that command stay
    // ignored, so read-only commands with data arguments are never flagged.
    it('flags a dangerous command wrapped in a substitution', () => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo $(rm -rf /)')).toBe(true);
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo `rm -rf /`')).toBe(true);
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'echo $(rm -rf ${HOME})')).toBe(
        true,
      );
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo "at $(rm -rf /)"')).toBe(
        true,
      );
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo $(echo $(rm -rf /))')).toBe(
        true,
      );
    });

    it('leaves data-bearing and arithmetic substitutions alone', () => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo $(date)')).toBe(false);
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo $((1 + 2))')).toBe(false);
      expect(
        matchSemanticShellPredicate('rmRecursiveHomeTarget', 'echo $(rm -rf /tmp/build-cache)'),
      ).toBe(false);
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo "rm -rf /"')).toBe(false);
    });

    it('still catches the direct command sharing a line with a substitution', () => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo $(date) && rm -rf /')).toBe(
        true,
      );
    });

    // A confident outer `rm` says nothing about its own substitutions: the
    // substitution runs FIRST, and the outer flags are the only ones the
    // precise resolvers see. `rm -f $(rm -rf ~)` therefore deletes home while
    // the outer command carries no recursive flag at all.
    it('inspects substitutions of a resolved rm command', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'rm -f $(rm -rf ~)')).toBe(true);
      expect(
        matchSemanticShellPredicate('rmRecursiveHomeTarget', 'rm -f $(rm -rf ~); echo ~'),
      ).toBe(true);
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'rm -f $(rm -rf /)')).toBe(true);
    });

    // Quoting provenance is stripped before the predicate layer sees a word, so
    // a QUOTED parenthesis arrives bare and the depth counter closes on the
    // wrong one (or never closes). The remainder is still analyzed, so the
    // executed delete cannot hide behind the unbalanced paren.
    it.each([
      'echo $(printf "("; rm -rf ~)',
      'echo $(printf "("; rm -rf ~); echo ~',
      'echo $(printf ")"; rm -rf ~)',
      'echo $(printf ")"; rm -rf ~); echo ~',
    ])('analyzes the substitution body when a quoted paren unbalances it: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(true);
    });

    it('leaves a resolved rm with a harmless substitution alone', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'rm -rf $(dirname /tmp/x)')).toBe(
        false,
      );
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'rm -rf $(pwd)/cache')).toBe(
        false,
      );
    });
  });

  describe('executable expansions outside argv', () => {
    // A redirection operand and a process substitution both RUN their command
    // before the outer command; the operand is not argv, so the tokenizer used
    // to drop it wholesale and the deletion never reached the predicates.
    it.each([
      ['rmRecursiveHomeTarget', 'echo >$(rm -rf ~); echo ~'],
      ['rmRecursiveRootTarget', 'echo >$(rm -rf /); echo ~'],
      ['rmRecursiveHomeTarget', 'echo >$(rm -rf ~)'],
    ] as const)('reads a substitution in a redirection operand (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each([
      ['rmRecursiveHomeTarget', 'cat <(rm -rf ~); echo ~'],
      ['rmRecursiveHomeTarget', 'cat <(rm -rf ~)'],
      ['rmRecursiveHomeTarget', 'diff <(ls ~) <(rm -rf ~)'],
      ['rmRecursiveRootTarget', 'tee >(rm -rf /)'],
    ] as const)('reads a process substitution body (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    // The payload of an outer substitution resolves to `rm` with only `-f`, so
    // the precise check passes — and the inner substitution, which runs first
    // and carries `-rf ~`, used to be skipped by the early return.
    it.each([
      ['rmRecursiveHomeTarget', 'echo $(rm -f $(rm -rf ~)); echo ~'],
      ['rmRecursiveRootTarget', 'echo $(rm -f $(rm -rf /))'],
      ['rmRecursiveHomeTarget', 'echo `rm -f $(rm -rf ~)`'],
    ] as const)(
      'inspects nested substitutions of a resolved rm payload (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    it('leaves data-only operands and benign substitutions alone', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'echo >/tmp/out')).toBe(false);
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'echo >$(date)')).toBe(false);
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'cat <(echo hi)')).toBe(false);
      expect(
        matchSemanticShellPredicate('rmRecursiveHomeTarget', 'cat <(rm -rf /tmp/build-cache)'),
      ).toBe(false);
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'echo $(rm -f $(date))')).toBe(
        false,
      );
    });

    // Single quotes and a backslash suppress expansion: the text is printed, not
    // executed. Quote stripping happens before the predicate layer, so the sigil
    // keeps a marker and the scan must not treat the literal as a substitution.
    it.each([
      "echo '$(rm -rf ~)'",
      "echo 'pre $(rm -rf ~) post'",
      "echo '`rm -rf ~`'",
      "echo '$(rm -rf ~)' | wc -c",
    ])('keeps a literal, non-expanding sigil inert: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
    });

    it('still flags the same text in double quotes, where it DOES expand', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'echo "$(rm -rf ~)"')).toBe(true);
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo "at $(rm -rf /)"')).toBe(
        true,
      );
    });

    // A backslash suppresses the expansion, so the parity in the word decides:
    // one literal backslash leaves a real substitution behind, and it runs.
    it('does not mistake a substitution behind a literal backslash for escaped text', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'echo \\\\$(rm -rf ~)')).toBe(
        true,
      );
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'echo \\$(rm -rf ~)')).toBe(
        false,
      );
    });

    // Inside double quotes a backslash still escapes `$` and the backtick, so
    // the escaped body is printed, not run.
    it.each(['echo "\\$(rm -rf ~)"', 'echo "pre \\$(rm -rf ~) post"', 'echo "\\`rm -rf ~\\`"'])(
      'keeps a backslash-escaped sigil inside double quotes inert: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
      },
    );

    // The caller's quoting does not survive an interpreter boundary: the outer
    // single quotes only stop the CALLING shell from expanding, while the child
    // shell runs the substitution.
    it.each([
      "bash -c 'echo $(rm -rf ~)'",
      "sh -c 'echo $(rm -rf ~)'",
      "eval 'echo $(rm -rf ~)'",
      "bash -c 'pre $(rm -rf ~) post'",
      "bash -c 'echo `rm -rf ~`'",
      "xargs bash -c 'echo $(rm -rf ~)'",
    ])('reads a quoted interpreter payload as fresh source: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(true);
    });

    it('keeps the literal rule inside a non-interpreter wrapper', () => {
      // `timeout` does not evaluate its arguments as shell source, so the
      // quoted text stays literal all the way down.
      expect(
        matchSemanticShellPredicate('rmRecursiveHomeTarget', "timeout 5 echo '$(rm -rf ~)'"),
      ).toBe(false);
    });
  });

  describe('nineteenth-round review: eval argument joining and payloads beside a bare rm', () => {
    // `help eval`: "Combine ARGs into a single string". Reparsing each argument
    // on its own split the command from its target: `rm -rf` has no target and
    // `~` has no executable, so both halves looked harmless while Bash ran
    // `rm -rf <home>`.
    it.each([
      ['rmRecursiveHomeTarget', "eval 'rm -rf' ~"],
      ['rmRecursiveHomeTarget', 'eval "rm -rf" ~'],
      ['rmRecursiveRootTarget', "eval 'rm -rf' /"],
      ['rmRecursiveRootTarget', 'eval rm -rf /'],
      ['rmRecursiveHomeTarget', "eval 'rm' '-rf' ~"],
    ] as const)('joins eval arguments before analyzing them (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each([
      ['rmRecursiveHomeTarget', "eval 'echo' hi"],
      ['rmRecursiveHomeTarget', "eval 'ls' -la"],
      ['rmRecursiveHomeTarget', "eval 'rm -rf' /tmp/build-cache"],
      ['rmRecursiveRootTarget', "eval 'rm -rf' /tmp/build-cache"],
    ] as const)(
      'keeps a joined eval payload data-only when it is harmless (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(false);
      },
    );

    // A positional `rm` makes rmIndex non-negative, which used to skip the
    // interpreter-payload branch: the outer `-c` carried no recursive flag, so
    // the destructive child shell was never inspected.
    it.each([
      ['rmRecursiveHomeTarget', "bash -c 'echo $(rm -rf ~)' rm"],
      ['rmRecursiveHomeTarget', "sh -c 'echo $(rm -rf ~)' rm"],
      ['rmRecursiveRootTarget', "bash -c 'echo $(rm -rf /)' rm"],
      ['rmRecursiveHomeTarget', "bash -ec 'echo $(rm -rf ~)' rm"],
    ] as const)(
      'inspects an interpreter payload even beside a bare rm (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    it('leaves a harmless interpreter payload beside a bare rm alone', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', "bash -c 'echo hi' rm")).toBe(
        false,
      );
      expect(
        matchSemanticShellPredicate('rmRecursiveHomeTarget', "bash -c 'rm -rf /tmp/cache' rm"),
      ).toBe(false);
    });
  });

  describe('twenty-first-round review: caller substitutions and interpreter options', () => {
    // The substitution is an ARGUMENT to the interpreter, so the calling shell
    // expands it before bash ever starts: `bash -c : "$(rm -rf ~)"`.
    it.each([
      ['rmRecursiveHomeTarget', 'bash -c : "$(rm -rf ~)"; echo ~'],
      ['rmRecursiveRootTarget', 'bash -c : "$(rm -rf /)"; echo ~'],
      ['rmRecursiveHomeTarget', 'bash -c \'echo hi\' "$(rm -rf ~)"'],
      ['rmRecursiveHomeTarget', 'eval : "$(rm -rf ~)"'],
    ] as const)(
      'inspects caller-level substitutions of an interpreter segment (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    it.each(['bash -c : "$(date)"; echo done', 'bash -c : "$(ls ~)"; echo done'])(
      'leaves a harmless caller-level substitution alone: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
      },
    );

    // `bash [option] ... -c command`: the payload is not necessarily the word
    // right after the executable, so the option walk has to reach `-c`.
    it.each([
      ['rmRecursiveHomeTarget', "bash -e -c 'echo $(rm -rf ~)' rm; echo ~"],
      ['rmRecursiveHomeTarget', "bash -x -e -c 'echo $(rm -rf ~)'"],
      ['rmRecursiveHomeTarget', "bash --norc -c 'echo $(rm -rf ~)'"],
      ['rmRecursiveRootTarget', "bash -e -c 'echo $(rm -rf /)' rm"],
    ] as const)('finds the payload after preceding options (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each(["bash -e -c 'echo hi'", "bash --norc -c 'rm -rf /tmp/cache'"])(
      'keeps a harmless payload behind options inert: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
      },
    );

    // `c` inside an option CLUSTER: the letters around it stay flags
    // (`bash [GNU long option] [option] ...`), so `bash -xce '<payload>'` runs
    // the payload that follows the whole option word. Verified against bash:
    // `bash -xce 'echo A' B` prints A, while `bash -cecho hi` fails with
    // `hi: invalid option name` — the rest of a cluster is never source.
    it.each([
      ['rmRecursiveHomeTarget', "bash -xce 'echo $(rm -rf ~)' rm; echo ~"],
      ['rmRecursiveHomeTarget', "bash -xce 'echo $(rm -rf ~)' rm"],
      ['rmRecursiveRootTarget', "bash -eCxc 'echo $(rm -rf /)' rm"],
      ['rmRecursiveHomeTarget', "bash -xec 'echo $(rm -rf ~)'"],
      ['rmRecursiveRootTarget', "sh -ec 'echo $(rm -rf /)'"],
      ['rmRecursiveHomeTarget', "xargs bash -xce 'echo $(rm -rf ~)'"],
    ] as const)('reads a payload behind a flag cluster (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each(["bash -xce 'echo hi' rm", "bash -xce 'rm -rf /tmp/cache'"])(
      'keeps a harmless payload behind a flag cluster inert: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
      },
    );

    // Value-taking option letters inside the cluster move the payload: Bash
    // consumes `pipefail` as the `-o` operand and runs the LATER `-c` payload
    // (`bash -xoc pipefail -c 'echo B'` prints B), so stopping at the first
    // `c` and reading `pipefail` as the command left the real payload unseen.
    it.each([
      ['rmRecursiveHomeTarget', "bash -xoc pipefail -c 'echo $(rm -rf ~)' rm; echo ~"],
      ['rmRecursiveHomeTarget', "bash -xoc pipefail -c 'echo $(rm -rf ~)'"],
      ['rmRecursiveRootTarget', "bash -eoc pipefail -c 'echo $(rm -rf /)' rm"],
      ['rmRecursiveHomeTarget', "bash -o posix -c 'echo $(rm -rf ~)' rm; echo ~"],
    ] as const)(
      'reads the payload after a clustered option operand (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    it.each(["bash -xoc pipefail -c 'echo hi'", "bash -o posix -c 'echo hi'"])(
      'keeps a harmless payload behind a clustered operand inert: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
      },
    );

    // `+`-prefixed words turn a flag OFF (`help set`); they are still option
    // words, so the walk must keep going: `bash +e -c '<payload>'` runs it.
    it.each([
      ['rmRecursiveHomeTarget', "bash +e -c 'echo $(rm -rf ~)' rm; echo ~"],
      ['rmRecursiveHomeTarget', "bash +e -c 'echo $(rm -rf ~)'"],
      ['rmRecursiveRootTarget', "sh +e -c 'echo $(rm -rf /)'"],
      ['rmRecursiveHomeTarget', "bash +e +x -c 'echo $(rm -rf ~)' rm"],
    ] as const)('reads a payload after plus-prefixed options (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each(["bash +e -c 'echo hi'", 'bash +e script.sh'])(
      'keeps a harmless command behind plus-prefixed options inert: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
      },
    );
  });
  describe('twenty-second-round review: locale-translation quoting in argv', () => {
    // `$"…"` is a QUOTED word at parse time: bash removes the `$`, translates
    // the string, then passes it as double-quoted text. Keeping the `$` inside
    // argv produced `$-rf`, which no flag check recognises, while the shell
    // still handed `-rf` to rm.
    it.each([
      ['rmRecursiveHomeTarget', 'rm $"-rf" ~'],
      ['rmRecursiveHomeTarget', 'LC_ALL=C rm $"-rf" ~'],
      ['rmRecursiveRootTarget', 'rm -rf $"/"'],
      ['rmRecursiveHomeTarget', 'rm "-rf" $"~"'],
      ['rmRecursiveHomeTarget', 'rm $"-rf" "${HOME}"'],
    ] as const)('reads the flag behind $"…" (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each(['echo $"-rf" ~', 'rm $"-f" /tmp/cache', 'echo $"rm -rf ~"', 'rm -rf $"/tmp/cache"'])(
      'leaves a harmless locale-quoted word alone: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
      },
    );
  });

  describe('twenty-third-round review: interpreter option operands and quoted heredocs', () => {
    // `-o option` / `-O shopt` take their value from the NEXT word. Walking
    // them as bare flags stopped at the operand (`posix`), so the `-c` payload
    // was never reached even though Bash runs it in the child shell.
    it.each([
      ['rmRecursiveHomeTarget', "bash -o posix -c 'echo $(rm -rf ~)' rm; echo ~"],
      ['rmRecursiveHomeTarget', "bash -o pipefail -ec 'echo $(rm -rf ~)'"],
      ['rmRecursiveHomeTarget', "bash -O extglob -c 'echo $(rm -rf ~)'"],
      ['rmRecursiveRootTarget', "bash -o posix -c 'echo $(rm -rf /)'"],
      ['rmRecursiveHomeTarget', "bash --rcfile /tmp/rc -c 'echo $(rm -rf ~)'"],
      ['rmRecursiveHomeTarget', "bash --init-file /tmp/rc -c 'echo $(rm -rf ~)'"],
      // `+o` turns an option off but still takes its operand from the next
      // word, so the walk must not stop at `posix` and miss the `-c` payload.
      ['rmRecursiveHomeTarget', "bash +o posix -c 'echo $(rm -rf ~)' rm"],
      ['rmRecursiveRootTarget', "bash +o posix -c 'echo $(rm -rf /)'"],
      ['rmRecursiveHomeTarget', "bash +e +o posix -c 'echo $(rm -rf ~)'"],
    ] as const)('consumes the option operand before -c (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each([
      // `time -p` is a value-free switch on the bash keyword
      // (`help time`: "time [-p] pipeline"), so it must not swallow `rm`.
      ['rmRecursiveHomeTarget', 'time -p rm -rf /tmp/cache ~'],
      ['rmRecursiveRootTarget', 'time -p rm -rf /'],
      ['rmRecursiveHomeTarget', 'time --portability rm -rf ~'],
    ] as const)('keeps the executable after a time switch (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each(['time -p echo hi', 'time -p rm -rf /tmp/cache', 'time --portability ls /tmp'])(
      'keeps a harmless pipeline behind a time switch inert: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
      },
    );

    it.each([
      "bash -o posix -c 'echo hi'",
      "bash -O extglob -c 'rm -rf /tmp/cache'",
      "bash --rcfile /tmp/rc -c 'echo hi'",
    ])('keeps a harmless payload behind an option operand inert: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
    });

    // A QUOTED heredoc delimiter disables expansion, so the substitution in
    // the body is literal stdin data and never runs.
    it.each([
      ["cat <<'EOF'\n$(rm -rf ~)\nEOF", 'rmRecursiveHomeTarget'],
      ['cat <<"EOF"\n$(rm -rf ~)\nEOF', 'rmRecursiveHomeTarget'],
      ['cat <<\\EOF\n$(rm -rf ~)\nEOF', 'rmRecursiveHomeTarget'],
      ["cat <<'EOF'\n$(rm -rf /)\nEOF", 'rmRecursiveRootTarget'],
      ["cat <<'EOF'\n`rm -rf ~`\nEOF", 'rmRecursiveHomeTarget'],
    ] as const)('leaves an unexpanded heredoc body literal (%s): %s', (command, predicate) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(false);
    });

    it.each([
      // Unquoted delimiter: the substitution still expands in the calling shell.
      ['rmRecursiveHomeTarget', 'cat <<EOF\n$(rm -rf ~)\nEOF'],
      // Quoted delimiter, but the body IS the child shell source.
      ['rmRecursiveRootTarget', "bash <<'EOF'\nrm -rf /\nEOF"],
      ['rmRecursiveHomeTarget', "sh <<'EOF'\nrm -rf ~\nEOF"],
    ] as const)('still blocks executable heredoc input (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });
  });
  describe('caller text cannot forge the literal-expansion marker', () => {
    // The marker is generated by the segmenter to mean "this sigil is inert".
    // A caller that types the same byte must not inherit that meaning.
    it.each([
      'echo \u0001$(rm -rf ~); echo ~',
      'echo \u0001`rm -rf ~`',
      'rm -rf \u0001$(rm -rf /)',
    ])('still inspects a substitution after a caller-supplied marker: %s', (command) => {
      expect(
        matchSemanticShellPredicate(
          command.includes('/)') ? 'rmRecursiveRootTarget' : 'rmRecursiveHomeTarget',
          command,
        ),
      ).toBe(true);
    });

    // ANSI-C escapes decode to the same byte AFTER the input was sanitized, so
    // `$'\1'` / `$'\x01'` must not inherit the marker's meaning either.
    it.each([
      ['rmRecursiveHomeTarget', "echo $'\\1'$(rm -rf ~); echo ~"],
      ['rmRecursiveRootTarget', "echo $'\\x01'`rm -rf /`"],
      ['rmRecursiveHomeTarget', "echo $'\\001'$(rm -rf ~)"],
      ['rmRecursiveRootTarget', "echo $'\\u0001'$(rm -rf /)"],
    ] as const)(
      'still inspects a substitution after a decoded marker (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    it('keeps quoted sigils inert', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', "echo '$(rm -rf ~)'")).toBe(
        false,
      );
    });

    // ANSI-C quoting is quoting too: the decoded text never expands, so
    // `$'$(rm -rf ~)'` only prints and must not require intervention.
    it.each(["echo $'$(rm -rf ~)'", "echo $'`rm -rf ~`'", "printf $'$(rm -rf /)'"])(
      'keeps an ANSI-C quoted sigil literal: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
      },
    );

    // Decoding still happens where it matters: the escapes become real argv.
    it.each([
      ['rmRecursiveRootTarget', "rm -rf $'\x2F'"],
      ['rmRecursiveHomeTarget', "$'\x72m' -rf ~"],
    ] as const)('still decodes ANSI-C escapes into real argv (%s): %s', (predicate, command) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });
  });

  // The two review findings below are about PROVENANCE of parsing state: a
  // substitution body owns its quoting, and a wrapper switch of unknown arity
  // must not be able to hide the command it runs.
  describe('twenty-fourth-round review: substitution quoting and wrapper option arity', () => {
    it('does not let an inner quote close the caller double-quoted region', () => {
      const command = `echo "$(echo '";')"; rm -rf ~`;
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(true);
      // Without the trailing deletion the same line is plain echo work.
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', `echo "$(echo '";')"`)).toBe(
        false,
      );
    });

    it.each([
      ['rmRecursiveHomeTarget', `echo "$(echo ")")"; rm -rf ~`],
      ['rmRecursiveHomeTarget', `echo $(echo ')'); rm -rf ~`],
    ] as const)(
      'keeps a quoted paren inside the substitution body (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    // `exec -c` and `setsid -f/--fork` take no value word, so the command that
    // follows them is the real executable — the unlisted switches used to eat
    // `rm` and leave `~` as a confidently unrelated executable.
    it.each([
      ['rmRecursiveHomeTarget', 'exec -c rm -rf /tmp/cache ~'],
      ['rmRecursiveHomeTarget', 'setsid -f rm -rf /tmp/cache ~'],
      ['rmRecursiveHomeTarget', 'setsid --fork rm -rf /tmp/cache ~'],
      ['rmRecursiveHomeTarget', 'exec -c -l rm -rf ~'],
      ['rmRecursiveRootTarget', 'exec -c rm -rf /'],
    ] as const)(
      'still blocks the wrapped command behind value-free wrapper switches (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    // Flag-position parameter expansion: the operand is invisible to a
    // dash-word filter, so `rm ${RM_FLAGS:--rf} ~` ran a recursive home delete
    // while every predicate returned false.
    it.each([
      ['rmRecursiveHomeTarget', 'rm ${RM_FLAGS:--rf} ~'],
      ['rmRecursiveHomeTarget', 'rm ${RM_FLAGS--rf} ~'],
      ['rmRecursiveHomeTarget', 'rm ${RM_FLAGS:=-rf} ~'],
      ['rmRecursiveRootTarget', 'rm ${F:--rf} /'],
    ] as const)(
      'still blocks a recursive flag hidden in a parameter expansion (%s): %s',
      (predicate, command) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    // Without a dash-shaped operand nothing recursive is visible, so the
    // ordinary rm call stays allowed.
    it.each(['rm ${FLAGS} ~', 'rm ${F:-x} ~'])(
      'leaves a non-flag expansion alone: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
      },
    );

    // A switch whose arity is unknown stays ambiguous, which routes the
    // segment through the fallback instead of trusting a guessed executable.
    it.each(['exec -Z rm -rf ~', 'setsid -Z rm -rf ~', 'nohup -Z rm -rf ~'])(
      'still blocks through the ambiguity fallback when the switch arity is unknown: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(true);
      },
    );
  });
});

describe('matchSemanticShellPredicate · multiword expansion defaults', () => {
  // A default can carry several argv words: `rm ${FLAGS:--r -f} ~` runs
  // `rm -r -f ~`, so a filter that only looks at the first dash word misses
  // the recursive flag entirely.
  it.each(['rm ${FLAGS:--r -f} ~', 'rm ${FLAGS:=-r -f} ~', 'rm ${FLAGS--r -f} ~'])(
    'blocks a multiword expansion default in flag position: %s',
    (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(true);
    },
  );

  it('leaves a multiword non-flag default alone', () => {
    expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'rm ${FLAGS:-x y} ~')).toBe(false);
  });
});

describe('matchSemanticShellPredicate · payload depth cap', () => {
  // Past the payload depth limit the nested source still executes, so the cap
  // must degrade to a coarser check instead of reporting "safe".
  it.each([
    ['rmRecursiveHomeTarget', 'echo $(echo $(echo $(echo $(rm -rf ~))))'],
    ['rmRecursiveHomeTarget', 'echo $(echo $(echo $(echo $(echo $(rm -rf ~)))))'],
    ['rmRecursiveRootTarget', 'echo $(echo $(echo $(echo $(echo $(rm -rf /)))))'],
  ] as const)('still blocks an rm nested past the depth cap (%s): %s', (predicate, command) => {
    expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
  });

  it('does not manufacture a match for a harmless deep payload', () => {
    expect(
      matchSemanticShellPredicate(
        'rmRecursiveHomeTarget',
        'echo $(echo $(echo $(echo $(echo hi))))',
      ),
    ).toBe(false);
  });
});
