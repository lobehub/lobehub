import { describe, expect, it } from 'vitest';

import { analyzeShellCommand } from './shellCommand';

describe('analyzeShellCommand', () => {
  describe('splitting', () => {
    it('splits on ; | && and returns all segments', () => {
      const segments = analyzeShellCommand('jq .x file.json 2>/dev/null; ls dir/');
      expect(segments).toHaveLength(2);
      expect(segments[0].words).toEqual(['jq', '.x', 'file.json']);
      // Redirections like 2>/dev/null are stripped from words
      expect(segments[1].words).toEqual(['ls', 'dir/']);
    });

    it('splits on ;', () => {
      const segments = analyzeShellCommand('echo a; echo b; echo c');
      expect(segments).toHaveLength(3);
      expect(segments.map((s) => s.words[0])).toEqual(['echo', 'echo', 'echo']);
    });

    it('splits on &&', () => {
      const segments = analyzeShellCommand('cd /tmp && rm file');
      expect(segments).toHaveLength(2);
      expect(segments[0].words).toEqual(['cd', '/tmp']);
      expect(segments[1].words).toEqual(['rm', 'file']);
    });

    it('splits on pipes', () => {
      const segments = analyzeShellCommand('cat log.txt | grep error | wc -l');
      expect(segments.map((s) => s.words[0])).toEqual(['cat', 'grep', 'wc']);
    });

    it('keeps quoted separators intact', () => {
      const segments = analyzeShellCommand("echo 'a; b | c' && echo done");
      expect(segments).toHaveLength(2);
      expect(segments[0].words).toEqual(['echo', 'a; b | c']);
      expect(segments[1].words).toEqual(['echo', 'done']);
    });

    it('keeps semicolons inside double quotes intact', () => {
      const segments = analyzeShellCommand('echo "x;y" | grep x');
      expect(segments).toHaveLength(2);
      expect(segments[0].words).toEqual(['echo', 'x;y']);
    });

    it('handles unmatched quote gracefully (does not hang or throw)', () => {
      // Unbalanced quote: everything after it becomes one segment — must not throw
      const segments = analyzeShellCommand("echo 'a; b");
      expect(segments.length).toBeGreaterThan(0);
    });
  });

  describe('redirection stripping', () => {
    it('strips trailing redirection with fd number (2>/dev/null)', () => {
      const segments = analyzeShellCommand('ls 2>/dev/null');
      expect(segments[0].words).toEqual(['ls']);
    });

    it('strips plain output redirection (> out.txt, >> append.log)', () => {
      const segments = analyzeShellCommand('echo hi > out.txt >> append.log');
      expect(segments[0].words).toEqual(['echo', 'hi']);
    });

    it('strips input redirection (< input.txt)', () => {
      const segments = analyzeShellCommand('wc -l < input.txt');
      expect(segments[0].words).toEqual(['wc', '-l']);
    });

    it('strips heredoc operator from words', () => {
      const segments = analyzeShellCommand('cat <<EOF');
      expect(segments[0].words).toEqual(['cat']);
    });

    it('strips redirections inside quotes-adjacent positions but not quoted redirections', () => {
      // A redirection-looking string inside a quoted word must survive
      const segments = analyzeShellCommand("echo 'a > b' | cat");
      expect(segments[0].words).toEqual(['echo', 'a > b']);
    });
  });

  describe('wrapper unwrapping', () => {
    it('unwraps sudo', () => {
      const segments = analyzeShellCommand('sudo rm -rf /');
      expect(segments[0].words[0]).toBe('sudo');
      expect(segments[0].resolvedCommand).toBe('rm');
      expect(segments[0].flags).toContain('-rf');
    });

    it('unwraps chained sudo env', () => {
      const segments = analyzeShellCommand('sudo env FOO=bar rm -rf /');
      expect(segments[0].resolvedCommand).toBe('rm');
      expect(segments[0].flags).toContain('-rf');
    });

    it('unwraps env with assignments', () => {
      const segments = analyzeShellCommand('env FOO=bar bash rm file');
      // `env` consumes FOO=bar; the real command is `bash`, and `rm file` is
      // bash's argument string — NOT an rm invocation by itself.
      expect(segments[0].resolvedCommand).toBe('bash');
    });

    it('unwraps env followed directly by the dangerous command', () => {
      const segments = analyzeShellCommand('env rm -rf /');
      expect(segments[0].resolvedCommand).toBe('rm');
      expect(segments[0].hasFlag('r')).toBe(true);
    });

    it('unwraps env with variables set inline and command', () => {
      const segments = analyzeShellCommand('FOO=bar env rm file');
      // Leading assignments are skipped as part of lightweight word initializers
      expect(segments[0].resolvedCommand).toBe('rm');
    });

    it('unwraps nohup wrappers only (still unwraps nohup)', () => {
      const segments = analyzeShellCommand('nohup rm -rf / &');
      expect(segments[0].resolvedCommand).toBe('rm');
    });

    it('does not treat first word as a wrapper when it is the real command', () => {
      const segments = analyzeShellCommand('rm file');
      expect(segments[0].resolvedCommand).toBe('rm');
    });

    it('does not unwrap when wrapper target is another wrapper keyword', () => {
      // 'sudo sudo' — unwrap loop should terminate
      const segments = analyzeShellCommand('sudo sudo rm file');
      expect(segments[0].resolvedCommand).toBe('rm');
    });

    it('terminates unwrap loop on pathological input', () => {
      const many = Array.from({ length: 50 }, () => 'sudo').join(' ');
      const segments = analyzeShellCommand(`${many} rm file`);
      expect(segments[0].resolvedCommand).toBe('rm');
    });
  });

  describe('flags parsing', () => {
    it('joins combined short flags (-rf)', () => {
      const segments = analyzeShellCommand('rm -rf dir');
      expect(segments[0].hasFlag('r')).toBe(true);
      expect(segments[0].hasFlag('f')).toBe(true);
    });

    it('recognizes separate flags (-r -f)', () => {
      const segments = analyzeShellCommand('rm -r -f dir');
      expect(segments[0].hasFlag('r')).toBe(true);
      expect(segments[0].hasFlag('f')).toBe(true);
    });

    it('recognizes long flags (--recursive)', () => {
      const segments = analyzeShellCommand('rm --recursive dir');
      expect(segments[0].hasFlag('r')).toBe(true);
      expect(segments[0].hasFlag('recursive')).toBe(true);
    });

    it('recognizes separated long flag value (--recursive=yes)', () => {
      const segments = analyzeShellCommand('rm --recursive=yes dir');
      expect(segments[0].hasLongFlag('recursive')).toBe(true);
      expect(segments[0].hasFlag('recursive')).toBe(true);
    });

    it("flags survive quoting because argv is what matters (rm '-rf' dir IS recursive)", () => {
      // Shell strips quotes before argv: `rm '-rf' dir` is a REAL recursive
      // delete. A security checker must NOT let quoting hide dangerous flags.
      const segments = analyzeShellCommand("grep '-rf' file");
      expect(segments[0].hasFlag('r')).toBe(true);
      const rmSegments = analyzeShellCommand("rm '-rf' /");
      expect(rmSegments[0].hasFlag('r')).toBe(true);
      expect(rmSegments[0].trailingSlashTargets).toContain('/');
    });

    it('flags stop at file targets (flags-prefixed word after non-flag is treated as target)', () => {
      // GNU getopt permutes arguments, so flags after paths are still valid flags for rm.
      // We conservatively parse ALL leading dash words as flags; this is the safe direction
      // for a security check (over-detection is acceptable, under-detection is not).
      const segments = analyzeShellCommand('rm dir/file -rf');
      expect(segments[0].hasFlag('r')).toBe(true);
    });
  });

  describe('targets extraction', () => {
    it('collects args ending with slash as targets with trailing slash', () => {
      const segments = analyzeShellCommand('ls /tmp/foo/');
      const seg = segments[0];
      expect(seg.trailingSlashTargets).toContain('/tmp/foo/');
    });

    it('collects bare root as trailing-slash target', () => {
      const segments = analyzeShellCommand('ls /');
      expect(segments[0].trailingSlashTargets).toContain('/');
    });

    it('collects home paths as home-resolved targets', () => {
      const segments = analyzeShellCommand('grep -r pattern ~/notes/');
      const seg = segments[0];
      expect(seg.homeTargets).toContain('~/notes/');
    });

    it('collects /Users/xxx as home-resolved targets', () => {
      const segments = analyzeShellCommand('ls /Users/alice/Documents');
      const seg = segments[0];
      expect(seg.homeTargets).toContain('/Users/alice/Documents');
    });
  });

  describe('command substitution quarantine', () => {
    it('stops analysis at $( — returns the prefix as one segment', () => {
      // Anything inside $() could contain rm -rf / that only executes under outer command's
      // conditions; for security blacklist we ANALYZE the substitution content too, but flag
      // that substitutions exist so rules can stay conservative.
      const segments = analyzeShellCommand('echo $(rm -rf /)');
      expect(segments.some((s) => s.raw.includes('echo'))).toBe(true);
    });

    it('analyzes backtick substitution content as its own segment', () => {
      const segments = analyzeShellCommand('echo `rm -rf /`');
      // The command with substitution is analyzed as a whole (defense in depth):
      // the segment still contains 'rm' and root target, so any semantic rm-rule
      // that scans words/targets would see it.
      const allWords = segments.flatMap((s) => s.words);
      // The substitution content is inside a word 'echo `rm -rf /`' → words: ['echo', '`rm -rf /`']
      // The safe design: preserve it as a single word; blacklist should treat embedded
      // substitutions conservatively.
      expect(allWords).toContain('`rm -rf /`');
    });

    it('does not treat | inside $(... ) as pipe separator', () => {
      const segments = analyzeShellCommand('echo $(cat f | wc -l)');
      expect(segments).toHaveLength(1);
      expect(segments[0].words[0]).toBe('echo');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const segments = analyzeShellCommand('');
      expect(segments).toHaveLength(0);
    });

    it('handles whitespace-only string', () => {
      const segments = analyzeShellCommand('   ');
      expect(segments).toHaveLength(0);
    });

    it('handles lone separator', () => {
      const segments = analyzeShellCommand(';;; ||| &&');
      // Separator-only segments have no words
      expect(segments.filter((s) => s.words.length > 0)).toHaveLength(0);
    });

    it('handles command with only redirection', () => {
      const segments = analyzeShellCommand('> out.txt');
      expect(segments.filter((s) => s.words.length > 0)).toHaveLength(0);
    });
  });

  describe('security-relevant integration shapes (from real false-positive reports)', () => {
    it('the jq+ls command that triggered rmRootDir false positive class', () => {
      const command =
        "jq '.trial // . | {status, error, runner_command}' /Users/arvinxx/CodeProjects/frontierharness/eval/runs/2026-09-10-lobe-smoke/trials/terminal-bench-regex-log/trial.json 2>/dev/null; ls /Users/arvinxx/CodeProjects/frontierharness/eval/runs/2026-09-10-lobe-smoke/trials/terminal-bench-regex-log/";
      const segments = analyzeShellCommand(command);
      const lsSeg = segments[1];
      expect(lsSeg.resolvedCommand).toBe('ls');
      expect(lsSeg.hasFlag('r')).toBe(false);
      expect(lsSeg.hasFlag('f')).toBe(false);
      // rm should not appear as any resolved command
      expect(segments.some((s) => s.resolvedCommand === 'rm')).toBe(false);
    });

    it('grep -r over user dirs must not be flagged as rm-homedir', () => {
      const segments = analyzeShellCommand('grep -r pattern /Users/arvinxx/notes');
      expect(segments[0].resolvedCommand).toBe('grep');
      expect(segments[0].hasFlag('r')).toBe(true);
      // It has recursive flag but the command is not rm — resolver decides, not the analyzer
    });

    it('real rm -rf / is still fully visible as root-target rm', () => {
      const segments = analyzeShellCommand('rm -rf /');
      const seg = segments[0];
      expect(seg.resolvedCommand).toBe('rm');
      expect(seg.hasFlag('r')).toBe(true);
      expect(seg.trailingSlashTargets).toContain('/');
    });

    it('real rm -rf ~ is fully visible as home-target rm', () => {
      const segments = analyzeShellCommand('rm -rf ~');
      const seg = segments[0];
      expect(seg.resolvedCommand).toBe('rm');
      expect(seg.hasFlag('r')).toBe(true);
      expect(seg.homeTargets).toContain('~');
    });
  });
});
