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
