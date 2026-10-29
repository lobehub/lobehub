import { describe, expect, it } from 'vitest';

import { stripGroupingParens } from '../shellQuoting';
import { analyzeShellCommand } from './index';

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

    it('keeps an escaped quote literal so the following separator still splits', () => {
      // `\"` is an argument to echo, not a quote opener: the `;` after it
      // starts a real second command. Entering quote state here swallows
      // `rm -rf ~` into the echo segment and hides it from every predicate.
      const segments = analyzeShellCommand('echo \\"; rm -rf ~');
      expect(segments).toHaveLength(2);
      expect(segments[0].words).toEqual(['echo', '"']);
      expect(segments[1].resolvedCommand).toBe('rm');
      expect(segments[1].homeTargets).toEqual(['~']);
    });

    it('does not split on an escaped separator', () => {
      const segments = analyzeShellCommand('echo x\\; rm -rf ~');
      expect(segments).toHaveLength(1);
      expect(segments[0].resolvedCommand).toBe('echo');
    });

    it('treats a word-initial # as a comment, not as quote syntax', () => {
      // The apostrophe in the comment is prose: bash ignores the whole line,
      // so the deletion on the next line is a real command. Letting the
      // apostrophe open quote state swallowed the newline and resolved the
      // segment to `#`, hiding `rm -rf ~` from every predicate.
      const segments = analyzeShellCommand("# Clean up the user's files\nrm -rf ~");
      expect(segments).toHaveLength(1);
      expect(segments[0].resolvedCommand).toBe('rm');
      expect(segments[0].homeTargets).toContain('~');

      // A trailing comment is dropped as well; the command before it stays.
      const trailing = analyzeShellCommand('rm -rf ~ # wipe the "old" dirs');
      expect(trailing).toHaveLength(1);
      expect(trailing[0].resolvedCommand).toBe('rm');
      expect(trailing[0].homeTargets).toContain('~');
    });

    it('keeps # literal when it does not start a word', () => {
      // In-word `#` is plain text; `${#var}` is preceded by `{`; `\#` is
      // escaped. None of them may start a comment.
      expect(analyzeShellCommand('echo foo#bar')[0].words).toEqual(['echo', 'foo#bar']);
      expect(analyzeShellCommand('echo ${#items[@]} && rm -rf ~')[1].resolvedCommand).toBe('rm');
      expect(analyzeShellCommand('echo \\#not-a-comment; rm -rf ~')[0].words).toContain(
        '#not-a-comment',
      );
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

  describe('brace expansion', () => {
    it('expands a brace group in command position into argv words', () => {
      // Bash expands before exec: `{rm,echo} -rf ~` runs `rm echo -rf <home>`,
      // so argv[0] is rm and the recursive home delete is real.
      const [segment] = analyzeShellCommand('{rm,echo} -rf ~');
      expect(segment.words).toEqual(['rm', 'echo', '-rf', '~']);
      expect(segment.resolvedCommand).toBe('rm');
      expect(segment.hasFlag('r')).toBe(true);
      expect(segment.homeTargets).toEqual(['~']);
    });

    it('expands brace flags exactly as before', () => {
      const [segment] = analyzeShellCommand('rm -r{f,} /');
      expect(segment.words).toEqual(['rm', '-rf', '-r', '/']);
      expect(segment.hasFlag('r')).toBe(true);
      expect(segment.trailingSlashTargets).toEqual(['/']);
    });

    it('leaves parameter expansions unexpanded', () => {
      // Bash does not brace-expand a `${…}` body, even when it contains a comma.
      const [segment] = analyzeShellCommand('rm -rf ${D:-a,b}');
      expect(segment.words).toEqual(['rm', '-rf', '${D:-a,b}']);
    });

    it('keeps the recursive flag when a flag expansion overflows its budget', () => {
      // 11 `{f,}` groups on the flag word exceed the variant cap, so the
      // literal `-r{f,}…` survives. The command slot is still a confident
      // `rm`, so the flag must be classified from the surviving text.
      const [segment] = analyzeShellCommand('rm -r{f,}{f,}{f,}{f,}{f,}{f,}{f,}{f,}{f,}{f,}{f,} ~');
      expect(segment.resolvedCommand).toBe('rm');
      expect(segment.hasFlag('r')).toBe(true);
      expect(segment.words).toContain('~');
    });

    it('refuses to resolve a command word whose expansion budget was exhausted', () => {
      // Six nested groups exceed the depth budget, so the literal group
      // survives — it must not be trusted as the executable name.
      const [segment] = analyzeShellCommand(
        '{{{{{{rm,echo},echo},echo},echo},echo},echo} -rf ~',
      );
      expect(segment.resolvedCommand).toBeNull();
      // Flag attribution falls back to the whole-segment view, which is what
      // the ambiguity fallback reads when the command slot is unresolvable.
      expect(segment.hasFlag('r')).toBe(true);
      expect(segment.words).toContain('~');
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

    it('stops wrapper option parsing at the end-of-options marker', () => {
      // `env -- rm -rf /tmp/cache ~`: `--` delimits the option list, so `rm`
      // is the wrapped command. Treating `--` as a value-taking flag ate `rm`,
      // read `/tmp/cache` as the value of `-rf`, and left `~` as a
      // confidently unrelated executable while bash deleted the home dir.
      const [seg] = analyzeShellCommand('env -- rm -rf /tmp/cache ~');
      expect(seg.resolvedCommand).toBe('rm');
      expect(seg.hasFlag('r')).toBe(true);
      expect(seg.homeTargets).toContain('~');

      // Same marker after sudo: `sudo -- rm -rf ~` deletes the home dir.
      const [sudo] = analyzeShellCommand('sudo -- rm -rf ~');
      expect(sudo.resolvedCommand).toBe('rm');
      expect(sudo.homeTargets).toContain('~');
    });

    it('reads wrapper long options by their declared arity', () => {
      // `env --ignore-environment rm -rf /tmp/cache ~`: the long option takes
      // no argument, so `rm` is the wrapped command. The single-letter regex
      // could not read `--ignore-environment`, the "unknown flag consumes a
      // value" default ate `rm`, `-rf` ate `/tmp/cache`, and `~` was left as a
      // confidently unrelated executable while bash deleted the home dir.
      const [envSeg] = analyzeShellCommand('env --ignore-environment rm -rf /tmp/cache ~');
      expect(envSeg.resolvedCommand).toBe('rm');
      expect(envSeg.hasFlag('r')).toBe(true);
      expect(envSeg.homeTargets).toContain('~');

      // Value-taking long options still consume their value word, so a
      // `--user root` value cannot become the executable.
      const [sudoSeg] = analyzeShellCommand('sudo --user root rm -rf ~');
      expect(sudoSeg.resolvedCommand).toBe('rm');
      expect(sudoSeg.homeTargets).toContain('~');

      const [envUnset] = analyzeShellCommand('env --unset FOO rm -rf ~');
      expect(envUnset.resolvedCommand).toBe('rm');

      // `--flag=value` keeps its embedded value attached.
      const [envChdir] = analyzeShellCommand('env --chdir=/tmp rm -rf ~');
      expect(envChdir.resolvedCommand).toBe('rm');

      // Unknown arity: either guess would hide a real rm invocation, so the
      // resolution reports ambiguity and the segment-level fallback judges it.
      const [unknown] = analyzeShellCommand('env --made-up-option rm -rf ~');
      expect(unknown.resolvedCommand).toBeNull();

      // Short options with an ATTACHED value: `-uFOO` already carries its
      // argument, so the following `rm` is the command, not another argument.
      const [attached] = analyzeShellCommand('env -uFOO rm -rf /tmp/cache ~');
      expect(attached.resolvedCommand).toBe('rm');
      expect(attached.homeTargets).toContain('~');

      // The attached value is an arbitrary string: `_` and `/` are part of the
      // argument, so the wrapper still ends before `rm`. Restricting the token
      // to a letter run swallowed `rm` here and left `~` as the executable.
      const [attachedScored] = analyzeShellCommand('env -uFOO_BAR rm -rf /tmp/cache ~');
      expect(attachedScored.resolvedCommand).toBe('rm');
      expect(attachedScored.homeTargets).toContain('~');

      const [attachedPath] = analyzeShellCommand('env -C/tmp rm -rf /tmp/cache ~');
      expect(attachedPath.resolvedCommand).toBe('rm');
      expect(attachedPath.homeTargets).toContain('~');

      // The same letter value-free but detached (`-u FOO`) still takes the
      // next word, so the command is the word after it.
      const [detached] = analyzeShellCommand('env -u FOO rm -rf /tmp/cache ~');
      expect(detached.resolvedCommand).toBe('rm');
      expect(detached.homeTargets).toContain('~');

      // Bare OPTIONAL-argument xargs long options take no value word either:
      // `--replace` defaults to `{}`, so `rm` is the wrapped command.
      const xargsSegments = analyzeShellCommand('printf x | xargs --replace rm -rf ~');
      const [xargsReplace] = xargsSegments.slice(-1);
      expect(xargsReplace.resolvedCommand).toBe('rm');
      expect(xargsReplace.homeTargets).toContain('~');
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

    it('counts a dash-shaped parameter-expansion operand in the flag position', () => {
      // `rm ${RM_FLAGS:--rf} ~` expands to `rm -rf ~` whenever RM_FLAGS is
      // unset. The raw word starts with `$`, so a dash-word-only filter dropped
      // the recursive flag and every predicate returned false.
      for (const command of [
        'rm ${RM_FLAGS:--rf} ~',
        'rm ${RM_FLAGS--rf} ~',
        'rm ${RM_FLAGS:=-rf} ~',
      ]) {
        const seg = analyzeShellCommand(command)[0];
        expect(seg.resolvedCommand).toBe('rm');
        expect(seg.flags).toEqual(['-rf']);
        expect(seg.hasFlag('r')).toBe(true);
        expect(seg.hasFlag('f')).toBe(true);
        expect(seg.homeTargets).toContain('~');
      }

      // An expansion with no dash operand (or a harmless one) is not a flag.
      expect(analyzeShellCommand('rm ${FLAGS} ~')[0].flags).toEqual([]);
      expect(analyzeShellCommand('rm ${F:-x} ~')[0].hasFlag('r')).toBe(false);

      // A default may hold several argv words, so every dash-shaped piece in
      // it becomes its own flag: `rm ${FLAGS:--r -f} ~` runs `rm -r -f ~`.
      const multi = analyzeShellCommand('rm ${FLAGS:--r -f} ~')[0];
      expect(multi.flags).toEqual(['-r', '-f']);
      expect(multi.hasFlag('r')).toBe(true);
      expect(multi.homeTargets).toContain('~');
      expect(analyzeShellCommand('rm ${FLAGS:-x y} ~')[0].flags).toEqual([]);
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

  describe('expansion and ANSI-C quoting', () => {
    it('keeps a parameter expansion with inner whitespace as one word', () => {
      expect(analyzeShellCommand('${X:-rm -rf /} done')[0].words).toEqual([
        '${X:-rm -rf /}',
        'done',
      ]);
    });

    it.each(['${CMD:-rm}', '${CMD}rm', '$X', '$1', '$@', 'r${X}m'])(
      'resolves a command word carrying an expansion (%s) to null',
      (word) => {
        expect(analyzeShellCommand(`${word} -rf /`)[0].resolvedCommand).toBeNull();
      },
    );

    it('decodes ANSI-C escapes into the real argv', () => {
      const [segment] = analyzeShellCommand("$'\\x72m' -rf $'\\057' $'a\\tb' $'\\'x'");
      expect(segment.resolvedCommand).toBe('rm');
      expect(segment.words).toEqual(['rm', '-rf', '/', 'a\tb', "'x"]);
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

    it('unquoted backslash escapes are consumed to the safe argv surface', () => {
      // `rm -rf \/` passes '/' as the target; matching must see '/', not '\/'.
      const segments = analyzeShellCommand('rm -rf \\/');
      expect(segments[0].trailingSlashTargets).toContain('/');
      // `\rm -rf /` executes rm: the escaped word resolves to command rm.
      expect(analyzeShellCommand('\\rm -rf /')[0].resolvedCommand).toBe('rm');
      // Backslash-newline is a line continuation, not a separator or literal.
      expect(analyzeShellCommand('rm -rf \\\n/')[0].trailingSlashTargets).toContain('/');
      // Double backslash stays a literal backslash (path escapes).
      expect(analyzeShellCommand('ls C:\\\\')[0].words).toContain('C:\\');
    });

    it("ANSI-C quoting $'…' strips to its payload like a quoted word", () => {
      expect(analyzeShellCommand(`bash -c $'rm -rf /'`)[0].words).toContain('rm -rf /');
    });

    it('path-qualified wrappers unwrap to the wrapped command', () => {
      for (const command of [
        '/usr/bin/sudo rm -rf ~',
        '/usr/bin/nohup rm -rf ~',
        '/usr/bin/nice rm -rf ~',
        '/bin/xargs rm -rf /',
      ]) {
        expect(analyzeShellCommand(command)[0].resolvedCommand).toBe('rm');
      }
    });

    it('xargs value-free flags do not swallow the wrapped command', () => {
      const seg = analyzeShellCommand('xargs -0 rm -rf harmless /home/alice')[0];
      expect(seg.resolvedCommand).toBe('rm');
      expect(seg.hasFlag('r')).toBe(true);
    });

    it('xargs value-free and optional-argument shorts keep the wrapped command', () => {
      // GNU xargs documents -t/--verbose, -p/--interactive, -x/--exit and
      // -o/--open-tty as value-free. An unlisted `t` consumed `rm` as its
      // option value, then `/tmp/cache` became the value of `-rf`, leaving `~`
      // as a confidently unrelated executable while the delete still ran.
      for (const command of [
        'printf x | xargs -t rm -rf /tmp/cache ~',
        'printf x | xargs -p rm -rf /tmp/cache ~',
        'printf x | xargs -x rm -rf /tmp/cache ~',
        'printf x | xargs -t0 rm -rf /tmp/cache ~',
        'printf x | xargs --verbose rm -rf /tmp/cache ~',
      ]) {
        const wrapper = analyzeShellCommand(command).at(-1);
        expect(wrapper?.resolvedCommand).toBe('rm');
        expect(wrapper?.homeTargets).toContain('~');
      }

      // Deprecated OPTIONAL-argument shorts: getopt accepts their argument
      // only when it is glued to the token, so the bare form (`-i` defaults to
      // `{}`) and the attached form (`-i{}`) both end the option here and the
      // next word is the wrapped command — neither may consume a value word.
      for (const command of [
        'printf x | xargs -i rm -rf /tmp/cache ~',
        'printf x | xargs -i{} rm -rf /tmp/cache ~',
        'printf x | xargs -l rm -rf /tmp/cache ~',
        'printf x | xargs -l5 rm -rf /tmp/cache ~',
      ]) {
        const wrapper = analyzeShellCommand(command).at(-1);
        expect(wrapper?.resolvedCommand).toBe('rm');
        expect(wrapper?.homeTargets).toContain('~');
      }
    });

    it('shell negation `!` is skipped as syntax, not treated as a command', () => {
      expect(analyzeShellCommand('! rm -rf ~')[0].resolvedCommand).toBe('rm');
    });

    it('heredoc bodies attach to their consuming command as one word', () => {
      // Delimiter line consumed; body becomes a single quoted word on the
      // consuming segment — never independent command segments.
      const segs = analyzeShellCommand('cat <<EOF\nrm -rf /\nEOF\nls');
      expect(segs[0].resolvedCommand).toBe('cat');
      expect(segs[0].words[1]).toBe('rm -rf /\n');
      // Trailing real command after the heredoc stays its own segment.
      expect(segs[1].resolvedCommand).toBe('ls');
    });

    it('heredoc operator forms: quoted delimiter, <<-, fd prefix, no delimiter', () => {
      // Quoted delimiter ('EOF') and <<- dash variant both strip cleanly.
      expect(analyzeShellCommand("cat <<'EOF'\nhi\nEOF")[0].words[1]).toBe('hi\n');
      expect(analyzeShellCommand('cat <<-EOF\nhi\nEOF')[0].words[1]).toBe('hi\n');
      // fd-prefixed operator keeps the fd as an inert word; command intact
      // (digit-stripping here would corrupt commands ending in digits).
      const fdSegs = analyzeShellCommand('base64 2<<EOF\nhi\nEOF');
      expect(fdSegs[0].resolvedCommand).toBe('base64');
      // Unterminated heredoc: body still attached (bash <<EOF + rm -rf /
      // with a missing delimiter line still executes).
      expect(analyzeShellCommand('cat <<EOF\nhi')[0].words[1]).toBe('hi');
    });

    it('a `;`/`&&` on the operator line closes the heredoc command', () => {
      // The rm after the separator is a REAL command and must stay visible.
      const segs = analyzeShellCommand('cat << EOF; rm -rf /');
      expect(segs[0].resolvedCommand).toBe('cat');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].trailingSlashTargets).toContain('/');
      const andSegs = analyzeShellCommand('cat << EOF && rm -rf ~');
      expect(andSegs[1].resolvedCommand).toBe('rm');
      expect(andSegs[1].homeTargets).toContain('~');
    });

    it('here-string `<<<` and in-word `<<` are not heredocs', () => {
      // <<< keeps its normal redirection handling; no body capture happens.
      const segs = analyzeShellCommand('grep pattern <<< "some data"');
      expect(segs[0].resolvedCommand).toBe('grep');
      // `a<<b` inside a word: bash treats `<<b` as a redirection operator,
      // so the tokenizer keeps `a` as the word and drops the redirection —
      // matching real shell argv. No heredoc state is entered (no body
      // lines are consumed as data).
      expect(analyzeShellCommand('echo a<<b')[0].words).toEqual(['echo', 'a']);
    });

    it('a redirection after the heredoc operator is not folded into the delimiter', () => {
      // `<<EOF >/dev/null` declares delimiter `EOF`; folding the redirection
      // in made the real terminator line unmatched, so the `rm` after the
      // heredoc was absorbed as stdin data and escaped every predicate.
      const segs = analyzeShellCommand('cat <<EOF >/dev/null\nhello\nEOF\nrm -rf ~');
      expect(segs[0].resolvedCommand).toBe('cat');
      expect(segs[0].words[1]).toBe('hello\n');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');
    });

    it('a leading descriptor duplication is a redirection, not a separator', () => {
      // Splitting on the `&` of `2>&1` produced the bogus commands `2>` and
      // `1 rm -rf ~`, whose resolved command was `1` — the recursive home
      // deletion then matched no predicate.
      const segs = analyzeShellCommand('2>&1 rm -rf ~');
      expect(segs).toHaveLength(1);
      expect(segs[0].resolvedCommand).toBe('rm');
      expect(segs[0].homeTargets).toContain('~');

      const bare = analyzeShellCommand('>&1 rm -rf /');
      expect(bare).toHaveLength(1);
      expect(bare[0].resolvedCommand).toBe('rm');
      expect(bare[0].trailingSlashTargets).toContain('/');

      // `&>` (redirect both streams) is also a redirection, not a background
      // separator, so the command that follows stays the resolved command.
      const both = analyzeShellCommand('&>/dev/null rm -rf ~');
      expect(both[0].resolvedCommand).toBe('rm');
    });

    it('`<<-` terminator lines may be tab-indented', () => {
      const segs = analyzeShellCommand('cat <<-EOF\n\thello\n\tEOF\nrm -rf ~');
      expect(segs[0].words[1]).toBe('hello\n');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');
    });

    it("an escaped apostrophe inside $'…' does not end the quote", () => {
      // ANSI-C quoting keeps backslash escapes live, so `\''` is a literal
      // apostrophe followed by the real terminator. Reading the escaped one
      // as the terminator reopened a phantom quote that absorbed the
      // separator, so the deletion already executed by bash was invisible.
      const segs = analyzeShellCommand("echo $'\\''; rm -rf ~");
      expect(segs).toHaveLength(2);
      expect(segs[0].resolvedCommand).toBe('echo');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');

      // Plain single quotes keep the backslash literal, so `\'` is a
      // backslash plus the real terminator and the deletion still splits —
      // exactly the difference the ANSI-C branch has to preserve.
      const plain = analyzeShellCommand("echo 'a\\'; rm -rf ~");
      expect(plain).toHaveLength(2);
      expect(plain[1].resolvedCommand).toBe('rm');
      expect(plain[1].homeTargets).toContain('~');
    });

    it('input descriptor duplication is a redirection, not a separator', () => {
      // `0<&0` duplicates stdin; recognizing only `>&` split this into `0<`
      // and `0 rm -rf ~`, whose resolved command was `0`.
      const segs = analyzeShellCommand('0<&0 rm -rf ~');
      expect(segs).toHaveLength(1);
      expect(segs[0].resolvedCommand).toBe('rm');
      expect(segs[0].homeTargets).toContain('~');

      const bare = analyzeShellCommand('<&0 rm -rf ~');
      expect(bare).toHaveLength(1);
      expect(bare[0].resolvedCommand).toBe('rm');
      expect(bare[0].homeTargets).toContain('~');
    });

    it('carries the command token index through subshell normalization', () => {
      // `(rm -rf ~ )` resolves to `rm`, but re-matching the normalized name
      // missed the raw `(rm` token, so argv came back empty and every
      // predicate read a deletion bash really executes as a bare word.
      const segs = analyzeShellCommand('(rm -rf ~ ); echo ~');
      expect(segs[0].resolvedCommand).toBe('rm');
      expect(segs[0].homeTargets).toContain('~');
    });

    it('keeps ANSI-C quoting live after an escaped backslash', () => {
      // `\\` is one literal backslash, so `$` still opens ANSI-C quoting and
      // the `;` after the terminator separates: bash deletes the home dir.
      // Rejecting any preceding backslash absorbed it into `echo`.
      const segs = analyzeShellCommand(String.raw`echo \\$'\''; rm -rf ~`);
      expect(segs).toHaveLength(2);
      expect(segs[0].resolvedCommand).toBe('echo');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');
    });

    it('applies double-quote escape rules to a quoted heredoc delimiter', () => {
      // `<<"E\\OF"` quote-removes to the delimiter `E\OF`; keeping both
      // declaration backslashes meant the real terminator never matched and
      // the deletion under the heredoc was read as `cat` data.
      const segs = analyzeShellCommand(String.raw`cat <<"E\\OF"
x
E\OF
rm -rf ~`);
      expect(segs[0].resolvedCommand).toBe('cat');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');
    });

    it('applies ANSI-C quote removal to a heredoc delimiter', () => {
      // `<<$'EOF'` quote-removes to the delimiter `EOF`; keeping the `$` made
      // the real terminator line never match, so the `rm -rf ~` below the
      // heredoc was read as `cat` stdin data and escaped every predicate.
      const segs = analyzeShellCommand("cat <<$'EOF'\nx\nEOF\nrm -rf ~");
      expect(segs[0].resolvedCommand).toBe('cat');
      expect(segs[0].words[1]).toBe('x\n');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');
    });

    it('applies locale-translation quote removal to a heredoc delimiter', () => {
      // `<<$"EOF"` is locale-translation quoting: bash removes the `$` and
      // treats the payload as a double-quoted word, so the delimiter is `EOF`.
      // Keeping the `$` made the terminator `$EOF` never match, so the
      // `rm -rf ~` below the heredoc was read as `cat` stdin data.
      const segs = analyzeShellCommand('cat <<$"EOF"\nx\nEOF\nrm -rf ~');
      expect(segs[0].resolvedCommand).toBe('cat');
      expect(segs[0].words[1]).toBe('x\n');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');
    });

    it('decodes ANSI-C escapes inside a heredoc delimiter', () => {
      // `$'E\x4fF'` decodes to `EOF`: the delimiter is the DECODED word, not
      // the literal escape text.
      const segs = analyzeShellCommand("cat <<$'E\\x4fF'\nx\nEOF\nrm -rf ~");
      expect(segs[0].words[1]).toBe('x\n');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');
    });

    it('a grouping paren does not hide the operand from target classification', () => {
      // `(rm -rf ~)` tokenizes the target as `~)` because `(`/`)` are
      // operators: classifying the raw word left homeTargets empty and every
      // predicate missed the deletion.
      const [home] = analyzeShellCommand('(rm -rf ~)');
      expect(home.resolvedCommand).toBe('rm');
      expect(home.homeTargets).toHaveLength(1);
      expect(stripGroupingParens(home.homeTargets[0])).toBe('~');

      const [slashed] = analyzeShellCommand('(rm -rf ~/)');
      expect(slashed.trailingSlashTargets).toHaveLength(1);
      expect(stripGroupingParens(slashed.trailingSlashTargets[0])).toBe('~/');
    });

    it('a heredoc delimiter ends at an operator without whitespace', () => {
      // `EOF>/dev/null` (no space) is delimiter `EOF` plus a redirection.
      // Folding the `>/dev/null` into the delimiter meant the terminator line
      // never matched and the trailing `rm -rf ~` was read as stdin data.
      const segs = analyzeShellCommand('cat <<EOF>/dev/null\nhello\nEOF\nrm -rf ~');
      expect(segs[0].resolvedCommand).toBe('cat');
      expect(segs[0].words[1]).toBe('hello\n');
      expect(segs[1].resolvedCommand).toBe('rm');
      expect(segs[1].homeTargets).toContain('~');

      // Same shape with a pipe: `<<EOF|wc` closes the delimiter at `|`.
      const piped = analyzeShellCommand('cat <<EOF|wc -l\nhello\nEOF\nrm -rf ~');
      expect(piped.some((seg) => seg.resolvedCommand === 'rm')).toBe(true);
    });
  });

  describe('twenty-fourth-round review: substitution quoting and wrapper option arity', () => {
    it('parses a $(…) body with its own quoting instead of the caller double quotes', () => {
      // The inner `"` belongs to the substitution's single-quoted string, so it
      // must NOT close the outer double quote. Reading it as the closing quote
      // split the segment at the inner `;` and left `')"` as a phantom quoted
      // region that swallowed the real command.
      const segments = analyzeShellCommand(`echo "$(echo '";')"; rm -rf ~`);
      expect(segments).toHaveLength(2);
      expect(segments[0].resolvedCommand).toBe('echo');
      expect(segments[1].resolvedCommand).toBe('rm');
      expect(segments[1].homeTargets).toContain('~');
    });

    it('keeps a quoted paren inside a substitution body from closing it', () => {
      // The `)` sits inside the substitution's own quotes, so the body ends at
      // the LAST paren and the separator after it still starts a new segment.
      const doubleQuoted = analyzeShellCommand(`echo "$(echo ")")"; rm -rf ~`);
      expect(doubleQuoted.at(-1)?.resolvedCommand).toBe('rm');

      const bare = analyzeShellCommand(`echo $(echo ')'); rm -rf ~`);
      expect(bare.at(-1)?.resolvedCommand).toBe('rm');
      expect(bare.at(-1)?.homeTargets).toContain('~');
    });

    it('resolves the wrapped command behind value-free exec/setsid switches', () => {
      // `help exec`: `exec [-cl] [-a name] [command …]`; `setsid --help`:
      // `-c/--ctty`, `-f/--fork`, `-w/--wait`. Unlisted, these switches were
      // treated as value-taking: they ate `rm`, then `/tmp/cache` became the
      // value of `-rf`, and `~` resolved as a confidently unrelated executable.
      for (const command of [
        'exec -c rm -rf /tmp/cache ~',
        'exec -c -l rm -rf ~',
        'setsid -f rm -rf /tmp/cache ~',
        'setsid --fork rm -rf /tmp/cache ~',
      ]) {
        const seg = analyzeShellCommand(command)[0];
        expect(seg.resolvedCommand).toBe('rm');
        expect(seg.homeTargets).toContain('~');
      }
    });

    it('reports ambiguity for a wrapper switch whose arity is unknown', () => {
      // Neither guess is safe: "value-free" resolves the option's value as the
      // command, "value-taking" eats the wrapped command and trusts whatever
      // follows. Unknown arity must stay ambiguous for the fallback to judge.
      for (const command of ['exec -Z rm -rf ~', 'setsid -Z rm -rf ~', 'nohup -Z rm -rf ~']) {
        expect(analyzeShellCommand(command)[0].resolvedCommand).toBeNull();
      }
    });
  });
});
