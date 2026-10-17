import { describe, expect, it } from 'vitest';

import { matchSemanticShellPredicate } from './semanticShellPredicates';

describe('matchSemanticShellPredicate', () => {
  describe('rmRecursiveRootTarget', () => {
    it.each([
      'rm -rf /',
      'rm -r /',
      'rm --recursive /',
      'rm -fr /',
      'rm -rf //',
      'rm -rf /./',
      'sudo rm -rf /',
      'sudo -u alice rm -rf /',
      'env rm -rf /',
      'nohup rm -rf /',
      'FOO=bar rm -rf /',
      "rm '-rf' /", // shell strips quotes before argv — must stay blocked
      'rm -rf / ; echo done',
      'echo start && rm -rf /',
      'cd /tmp && sudo rm -rf /',
      // Root glob: `/*` expands to the whole root subtree.
      'rm -rf /*',
      'rm -rf /**',
    ])('blocks: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it.each([
      // The original false-positive class: read-only commands whose SUBSTRINGS
      // used to satisfy the old `rm.*-r.*/\s*$` regex.
      "jq '.trial // . | {status, error, runner_command}' /Users/arvinxx/CodeProjects/frontierharness/eval/runs/2026-09-10-lobe-smoke/trials/terminal-bench-regex-log/trial.json 2>/dev/null; ls /Users/arvinxx/CodeProjects/frontierharness/eval/runs/2026-09-10-lobe-smoke/trials/terminal-bench-regex-log/",
      'ls /Users/arvinxx/CodeProjects/terminal/',
      'ls /',
      'cd /',
      'cat firmware/README.md | grep -r term',
      'npm run build --prefix ./packages/app/',
      'terraform -chdir=infra/ plan',
      'rm -rf /tmp/build-cache',
      'rm -rf ./dist',
      'rm file.txt',
      'rm -f file.txt',
      'rm -rf dir',
      'grep -r pattern /Users/arvinxx/notes',
      'grep -ri todo /home/dev/project/',
      'du -sh /Users/arvinxx/',
      'find /Users/arvinxx -name "*.log"',
      'ls -la /usr/local/bin/',
      // A root glob that names a real segment is a subset delete, not the root.
      'rm -rf /*.log',
      'rm -rf /tmp/*',
      // Unknown predicate must never match (forward compatibility).
    ])('allows: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
    });

    it('returns false for unknown predicate names (fail-open)', () => {
      expect(matchSemanticShellPredicate('timeTravelAndDeleteEverything', 'rm -rf /')).toBe(false);
    });

    it('returns false for non-string-ish input', () => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', '')).toBe(false);
    });
  });

  describe('rmRecursiveHomeTarget', () => {
    it.each([
      'rm -rf ~',
      'rm -rf ~/',
      'rm -r ~',
      'rm --recursive ~',
      'sudo rm -rf ~',
      'rm -rf $HOME',
      'rm -rf $HOME/',
      'rm -rf /Users/alice',
      'rm -rf /Users/alice/',
      'rm -rf /home/bob',
      "rm '-r' ~",
      'echo x; rm -rf ~/',
    ])('blocks: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(true);
    });

    it.each([
      // Deletes INSIDE the home tree are routine agent work — must not block.
      'rm -rf ~/notes/old',
      'rm -rf ~/.cache',
      'rm -r ~/.config/some-app',
      'rm -rf /Users/alice/projects/sandbox',
      'rm -rf /home/bob/tmp/build',
      // Not rm at all.
      'ls ~',
      'du -sh /Users/arvinxx/',
      'grep -r pattern /Users/arvinxx/notes',
      'cat ~/.zshrc',
    ])('allows: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(false);
    });
  });

  describe('rmForceDotTarget', () => {
    it.each(['rm -rf .', 'rm -rf ./', 'rm -Rf .', 'sudo rm -rf .'])('blocks: %s', (command) => {
      expect(matchSemanticShellPredicate('rmForceDotTarget', command)).toBe(true);
    });

    it.each(['rm -r .', 'rm -f .', 'rm -rf ./dist', 'rm file'])('allows: %s', (command) => {
      expect(matchSemanticShellPredicate('rmForceDotTarget', command)).toBe(false);
    });
  });

  // Third review round (codex, PR #19386): `chroot NEWROOT COMMAND` runs
  // COMMAND with NEWROOT as `/`. Both removed regex rules matched this shape
  // incidentally (`rm … -r … /` appeared in the raw string), so chroot must be
  // unwrapped like every other exec prefix or coverage narrows.
  describe('chroot exec-prefix (third review round)', () => {
    it.each([
      'chroot /mnt rm -rf /',
      'chroot /mnt /bin/rm -rf /',
      'chroot --skip-chdir /mnt rm -rf /',
      'sudo chroot /mnt rm -rf /',
    ])('blocks root delete behind chroot: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it.each(['chroot /mnt rm -rf /tmp/build-cache', 'chroot /mnt ls /tmp'])(
      'keeps a harmless target behind chroot allowed: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
      },
    );
  });

  // Ninth review round (codex, PR #19386): `builtin [shell-builtin [arg …]]`
  // executes the named shell builtin, so `builtin command rm -rf /` and
  // `builtin eval rm -rf /` do run the deletion. It must unwrap like
  // `command`/`exec`; otherwise it resolves to `builtin`, which the ambiguity
  // fallback deliberately ignores (it is not an ambiguous-command hint).
  describe('builtin shell builtin (ninth review round)', () => {
    it.each([
      'builtin command rm -rf /',
      'builtin eval rm -rf /',
      'builtin exec rm -rf /',
      'sudo builtin command rm -rf /',
    ])('blocks root delete behind builtin: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it('blocks a home delete behind builtin', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'builtin eval "rm -rf ~"')).toBe(
        true,
      );
    });

    it.each(['builtin command ls /tmp', 'builtin eval "rm -rf /tmp/build-cache"'])(
      'keeps a harmless command behind builtin allowed: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
      },
    );
  });

  // Tenth review round (codex, PR #19386): two more "the command position
  // cannot be resolved statically" shapes. `coproc [NAME] command` executes
  // the command, but NAME is optional so the word after `coproc` is not
  // statically the command; and a variable can supply argv[0] (`X=rm; $X -rf
  // /`). Both must stay conservative instead of trusting the literal word.
  describe('unresolvable command position (tenth review round)', () => {
    it.each([
      'coproc rm -rf /',
      'coproc myproc rm -rf /',
      'X=rm; $X -rf /',
      'CMD=rm; ${CMD} -rf /',
    ])('blocks a root delete behind an unresolvable command slot: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it('blocks a home delete behind a variable-expanded command', () => {
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'X=rm; $X -rf ~')).toBe(true);
    });

    it.each(['coproc ls /tmp', 'coproc myproc', 'X=ls; $X -rf /tmp/build-cache'])(
      'keeps harmless unresolvable slots allowed: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
      },
    );

    // Guards the amplification this change could introduce: a quoted rm
    // string is an argument to another command, not a command.
    it.each(['echo "rm -rf /"', 'printf "rm -rf /\\n"'])(
      'does not turn quoted rm text into a match: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
      },
    );
  });

  // Eleventh review round (codex, PR #19386): three rule-completeness gaps.
  // - root-wide globs beyond `*` (`/?*`, `/[a-z]*`) expand to the top level;
  // - compound-command syntax (`{ … }`, `( … )`, `case … in a) …`) is an
  //   introducer, not a command, and must not hide the body behind it;
  // - Bash double-quote escaping keeps a backslash literal before any
  //   non-special character, so `rm -rf "\/"` targets `\/`, not `/`.
  describe('root-wide globs, compound syntax and quote escapes (eleventh review round)', () => {
    it.each(['rm -rf /?*/', 'rm -rf /?', 'rm -rf /[a-z]*/', 'rm -rf /.*'])(
      'blocks a root-wide glob form: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
      },
    );

    it.each(['rm -rf /*.log', 'rm -rf /tmp/*', 'rm -rf /tmp*/'])(
      'keeps a narrowed subset glob allowed: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
      },
    );

    it.each([
      '{ rm -rf /*; }; echo /',
      'case x in a) rm -rf /;; esac',
      '( rm -rf / )',
      '(rm -rf /)',
      'f() { rm -rf /; }',
    ])('blocks a delete inside compound-command syntax: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it.each(['{ echo "rm -rf /"; }', 'case x in a) echo "rm -rf /";; esac'])(
      'keeps a harmless compound body allowed: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
      },
    );

    it('treats a backslash before a non-special character as literal in double quotes', () => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'rm -rf "\\/"')).toBe(false);
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'rm -rf "a\\/b"')).toBe(false);
      // …while a genuinely quoted root or home still blocks.
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'rm -rf "/"')).toBe(true);
      expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', 'rm -rf "$HOME"')).toBe(true);
    });
  });

  describe('codex review regressions (bypass hardening)', () => {
    it.each([
      // #1 Unescaped newlines are command separators — second line must resolve.
      'echo ok\nrm -rf /',
      'echo ok\r\nrm -rf /',
      'echo ok\nsudo rm -rf /',
    ])('blocks multi-line root bypass: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it.each(['echo ok;\necho hi\nrm -rf ~', 'echo ok\nrm -rf ~'])(
      'blocks multi-line home bypass: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveHomeTarget', command)).toBe(true);
      },
    );

    it('keeps newlines inside quotes inert (not a separator)', () => {
      const command = "printf 'line1\nline2' | cat";
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
    });

    it.each([
      // #2 Value-free wrapper options must not swallow the command.
      'sudo -n rm -rf /',
      'env -i rm -rf /',
      'sudo -n rm -rf ~',
      // Value-TAKING wrapper options still consume their value…
      'sudo -u alice rm -rf /',
      // …including their value hiding further flags.
      'sudo -u alice rm -rf ~',
      // Long forms embed the value and consume nothing extra.
      'sudo --user=alice rm -rf /',
      // Combined wrapper flags with an embedded value-free flag.
      'sudo -ln rm -rf /',
    ])('blocks wrapper-option bypass: %s', (command) => {
      expect(
        matchSemanticShellPredicate('rmRecursiveRootTarget', command) ||
          matchSemanticShellPredicate('rmRecursiveHomeTarget', command),
      ).toBe(true);
    });

    it('still blocks plain value-taking wrapper usage (no regression)', () => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'sudo -u alice rm -rf /')).toBe(
        true,
      );
    });

    it.each([
      // #3 Path-qualified executables normalize to basename.
      '/bin/rm -rf /',
      '/usr/bin/rm -rf ~',
      './rm -rf /',
      '/bin/rm -rf / ; ls ok',
    ])('blocks path-qualified bypass: %s', (command) => {
      expect(
        matchSemanticShellPredicate('rmRecursiveRootTarget', command) ||
          matchSemanticShellPredicate('rmRecursiveHomeTarget', command),
      ).toBe(true);
    });

    it('keeps root path as a target, not a command basename', () => {
      // `rm -rf /` — the standalone `/` is the TARGET; resolvedCommand is rm.
      const command = 'rm -rf /';
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it.each([
      // #4 bash `command` builtin executes its argument directly.
      'command rm -rf /',
      'command rm -rf ~',
      'command -p rm -rf /',
      'sudo command rm -rf /',
    ])('blocks command-builtin bypass: %s', (command) => {
      expect(
        matchSemanticShellPredicate('rmRecursiveRootTarget', command) ||
          matchSemanticShellPredicate('rmRecursiveHomeTarget', command),
      ).toBe(true);
    });

    it('command -v/-V describe mode is not a rm execution (fails open safely)', () => {
      // `command -v rm` only PRINTS the path; no deletion happens. The
      // unwrapping stops at `-v`'s value `rm`, resolvedCommand becomes `rm`
      // with no recursive flag — predicate needs flag+target, so no block.
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'command -v rm')).toBe(false);
    });
  });

  describe('independent review regressions (SEC-1/SEC-2 hardening)', () => {
    it.each([
      // Value-taking sudo options the old whitelist missed — the flag's VALUE
      // used to resolve as the command, letting real rm slip through.
      'sudo -p password: rm -rf /',
      'sudo -R /chroot rm -rf /',
      'sudo -r sys_t rm -rf /',
      'sudo -T 10 rm -rf /',
      'env -u FOO rm -rf /',
      // Positional wrapper values (timeout DURATION, flock LOCKFILE).
      'timeout 30 rm -rf /',
      'timeout 30 rm -rf ~',
      'flock /tmp/lock rm -rf /',
      // Option values that ARE the payload (ambiguous-shape fallback).
      'env -S rm -rf /',
      'bash -c rm -rf /',
      'bash -c "rm -rf /"',
      'sh -c rm -rf ~',
      // Embedded option values (stdbuf -o0 style, no '=' present).
      'stdbuf -o0 rm -rf /',
      // Exec-prefix wrappers previously unwrapped nowhere (SEC-2).
      'exec rm -rf /',
      'exec rm -rf ~',
      'xargs rm -rf /',
      'nice rm -rf /',
      'setsid rm -rf /',
      'ionice rm -rf /',
      'strace rm -rf /',
      'time rm -rf /',
      // Compounds and multi-line shapes sharing these wrappers.
      'echo ok\nxargs rm -rf /',
      'find . | xargs rm -rf /',
      // Second codex round: escapes, negation, path-qualified wrappers,
      // xargs value-free flags, long-flag fallback, brace targets.
      'rm -rf \\/',
      '\\rm -rf /',
      '! rm -rf ~',
      '/usr/bin/sudo rm -rf ~',
      '/usr/bin/nohup rm -rf ~',
      '/usr/bin/nice rm -rf ~',
      'xargs -0 rm -rf /',
      'xargs -0 rm -rf harmless /home/alice',
      'xargs rm --recursive /',
      'bash -c " rm -rf /"',
      'bash -c "cd / && rm -rf /"',
      `bash -c $'rm -rf /'`,
      'bash -c "cd x && rm -rf ~"',
      `env -S$'rm -rf /'`,
      'env -S"rm -rf /"',
      'rm -rf {/,/etc}',
      'rm -rf /.',
      // Third codex round: eval executes its string-concatenated arguments.
      'eval rm -rf /',
      'eval rm -rf ~',
      'eval "cd / && rm -rf /"',
      // Third codex round: shell-interpreter-consumed heredoc bodies ARE
      // executed payloads; body attachment must keep them blockable.
      'bash <<EOF\nrm -rf /\nEOF',
      'bash <<EOF\nrm -rf /',
      // Fourth codex round: BusyBox launcher executes the applet.
      'busybox rm -rf /',
      '/bin/busybox rm -rf ~',
      // Fifth codex round: command substitution in the COMMAND position —
      // the shell executes the substitution's output, argv[0] is
      // unknowable at parse time.
      '$(printf rm) -rf ~',
      '$(printf rm) -rf /',
      '`printf rm` -rf /',
      // Sixth codex round: reserved words are shell SYNTAX — the first
      // follower of if/then/do is the real executing command.
      'if true; then rm -rf /; fi; ls /',
      'if true; then rm -rf ~; fi',
      'while true; do rm -rf /; done',
      'until false; do rm -rf ~; done',
      // Seventh codex round, P1 batch: IFS field separators, the runuser
      // exec wrapper, and parent traversal into root-level globs.
      'rm${IFS}-rf${IFS}/',
      'runuser -u nobody -- rm -rf /',
      'runuser --login nobody rm -rf /',
      'rm -rf /tmp/../*/',
      'rm -rf /tmp/../',
      'rm -rf /tmp/..',
    ])('blocks review-found bypass: %s', (command) => {
      expect(
        matchSemanticShellPredicate('rmRecursiveRootTarget', command) ||
          matchSemanticShellPredicate('rmRecursiveHomeTarget', command) ||
          matchSemanticShellPredicate('rmForceDotTarget', command),
      ).toBe(true);
    });

    it.each([
      // Value-free whitelist flags must NOT over-consume: rm stays resolvable
      // and the (safe) target decides the verdict.
      'sudo -n rm -rf /tmp/build',
      'sudo -v && echo ok',
      'sudo -l',
      'sudo -A rm -rf /tmp/build-cache',
      'env -i ls /',
      'command -v rm',
      'time ls /',
      'nice -n 10 ls /',
      'timeout 30 ls /',
      'flock /tmp/lock ls /',
      'stdbuf -o0 ls /',
      // Quoted/argument rm strings under confident non-rm commands stay
      // allowed — no re-creation of the substring false-positive class.
      "echo 'rm -rf /'",
      'echo $(date) && ls /',
      // -c payloads whose PARSED segments are not dangerous no longer
      // over-detect (the old prefix-regex fallback flagged these).
      'bash -c "rm -rf /tmp/build-cache"',
      'bash -c "rm -rf ~/notes/old"',
      'env -S"rm -rf /tmp/build-cache"',
      // Escapes that only quote SAFE words must not flip the verdict.
      'rm -rf \\/tmp/build-cache',
      // Third codex round: heredoc bodies are stdin DATA for their consuming
      // command — newline separators inside them are inert, and a dangerous-
      // looking body must not turn `cat` into a blocked command.
      "cat <<'EOF'\nrm -rf /\nEOF",
      'cat <<EOF\nrm -rf /\nEOF',
      'cat <<-EOF\nrm -rf /\nEOF',
      'cat 2<<EOF\nrm -rf /\nEOF',
      'cat <<EOF\nrm -rf /\nEOF\nls',
      // Substitution as an ARGUMENT stays allowed — the confident command
      // (echo) is unrelated to rm; execution-level risk belongs to the exec
      // sandbox, not the blacklist.
      'echo $(rm -rf /)',
      'echo `rm -rf /`',
      // Routine substitutions with no recursive flag next to them.
      '$(date)',
      '$(git rev-parse HEAD)',
      // Control-flow bodies holding only harmless commands stay allowed.
      'if true; then echo ok; fi',
      'if true; then echo rm -rf /; fi',
      // Quoted ${IFS} is a literal, not a field separator.
      "echo '${IFS}'",
      // Real sub-path targets behind traversal stay non-root.
      'rm -rf /tmp/../notes/old',
      'rm -rf /tmp/build/../cache',
      // runuser describing itself / benign user switch.
      'runuser -l alice whoami',
    ])('allows legitimate usage: %s', (command) => {
      expect(
        matchSemanticShellPredicate('rmRecursiveRootTarget', command) ||
          matchSemanticShellPredicate('rmRecursiveHomeTarget', command) ||
          matchSemanticShellPredicate('rmForceDotTarget', command),
      ).toBe(false);
    });

    it.each([
      // Seventh codex round: target families stay disjoint — the precise
      // root resolver must not fire on dot shapes that belong to the dot
      // rule (which additionally demands the force flag).
      { command: 'rm -r .', predicate: 'rmRecursiveRootTarget' },
      { command: 'rm -r ./', predicate: 'rmRecursiveRootTarget' },
      // Wrapper options are NOT rm options: flags are collected from the
      // resolved command's argv only.
      { command: 'xargs -r rm /', predicate: 'rmRecursiveRootTarget' },
      { command: 'sudo -r sysadm_r rm /', predicate: 'rmRecursiveRootTarget' },
      { command: 'flock -x /tmp/l rm /', predicate: 'rmRecursiveRootTarget' },
    ])('precise predicates keep their scope: $command', ({ command, predicate }) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(false);
    });

    it.each([
      // The scoped shapes still fire on their own rules.
      { command: 'rm -rf .', predicate: 'rmForceDotTarget' },
      { command: 'rm -r /', predicate: 'rmRecursiveRootTarget' },
      { command: 'xargs -0 rm -rf /', predicate: 'rmRecursiveRootTarget' },
      { command: 'sudo rm -rf /', predicate: 'rmRecursiveRootTarget' },
    ])('legitimate dangerous shapes still block: $command', ({ command, predicate }) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });

    it.each([
      // Fourth codex round: the ambiguity fallback honours the REQUESTED
      // predicate's target family — a root-shaped payload must match the
      // root rule only, never mislabel as the home/dot rule (and a home-
      // scoped matcher must stay silent on it).
      { command: 'bash -c "rm -rf /"', predicate: 'rmRecursiveHomeTarget' },
      { command: 'bash -c "rm -rf /"', predicate: 'rmForceDotTarget' },
      { command: 'eval rm -rf /', predicate: 'rmRecursiveHomeTarget' },
      { command: `env -S"rm -rf /"`, predicate: 'rmRecursiveHomeTarget' },
      { command: 'xargs -0 rm --recursive /', predicate: 'rmRecursiveHomeTarget' },
    ])('fallback stays scoped to the requested predicate: $predicate', ({ command, predicate }) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(false);
    });

    it.each([
      { command: 'bash -c "rm -rf /"', predicate: 'rmRecursiveRootTarget' },
      { command: 'bash -c "rm -rf ~"', predicate: 'rmRecursiveHomeTarget' },
      { command: 'eval rm -rf /', predicate: 'rmRecursiveRootTarget' },
      { command: 'bash <<EOF\nrm -rf /\nEOF', predicate: 'rmRecursiveRootTarget' },
    ])('fallback still fires on the correct predicate: $predicate', ({ command, predicate }) => {
      expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
    });
  });

  describe('twelfth-round review: expansions, ANSI-C quoting, traversal above root', () => {
    it.each([
      '${CMD:-rm} -rf /',
      '${CMD}rm -rf /',
      'r${X}m -rf /',
      '$1 -rf /',
      '$@ -rf /',
      '"$X" -rf /',
      'sudo $X -rf /',
      'sudo ${CMD:-rm} -rf /',
      'timeout 30 ${X:-rm} -rf /',
      '${X:-rm -rf /}',
      'sudo ${X:-rm -rf /}',
    ])('treats a parameter expansion in the command slot as unresolved: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it.each([
      "$'\\x72m' -rf /",
      "$'\\162m' -rf /",
      "$'\\u0072m' -rf /",
      "$'rm' -rf /",
      "rm -rf $'\\x2f'",
    ])('decodes ANSI-C quoting before matching: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
    });

    it.each(['rm --no-preserve-root -rf /../', 'rm -rf /..', 'rm -rf /../../', 'rm -rf /../*'])(
      'normalizes parent traversal above root to root: %s',
      (command) => {
        expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(true);
      },
    );

    it.each([
      { command: 'rm -rf ${Y:-/}', predicate: 'rmRecursiveRootTarget' },
      { command: 'rm -rf ${D:-~}', predicate: 'rmRecursiveHomeTarget' },
      { command: 'rm -rf ${D:=.}', predicate: 'rmForceDotTarget' },
    ])(
      'matches a target reachable through an expansion operand: $command',
      ({ command, predicate }) => {
        expect(matchSemanticShellPredicate(predicate, command)).toBe(true);
      },
    );

    it.each([
      'rm -rf /../tmp',
      'rm -rf "${OUT:-dist}/"',
      'echo ${X:-rm} -rf /',
      'echo ${X:-rm -rf /}',
      "echo $'rm -rf /'",
      '$EDITOR -r /tmp/foo',
      'ls ${HOME}/x',
    ])('keeps non-root shapes allowed: %s', (command) => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', command)).toBe(false);
    });
  });

  describe('command substitution containment', () => {
    // Substitution bodies stay embedded inside words rather than splitting the
    // outer command. The predicates above only fire on `rm` as the RESOLVED
    // command of a segment, so `echo $(rm -rf /)` does not fire rmRecursiveRootTarget.
    // This is deliberate: execution-level protections are the exec sandbox's
    // job; the blacklist targets unambiguous direct invocations. What matters
    // for regression safety is that read-only commands are never flagged.
    it('does not flag substitution content as a direct rm invocation', () => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo $(rm -rf /)')).toBe(false);
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo `rm -rf /`')).toBe(false);
    });

    it('still catches the direct command sharing a line with a substitution', () => {
      expect(matchSemanticShellPredicate('rmRecursiveRootTarget', 'echo $(date) && rm -rf /')).toBe(
        true,
      );
    });
  });
});
