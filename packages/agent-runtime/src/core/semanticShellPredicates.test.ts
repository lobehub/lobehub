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
