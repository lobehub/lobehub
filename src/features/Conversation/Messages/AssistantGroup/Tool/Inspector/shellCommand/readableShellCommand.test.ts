import { describe, expect, it } from 'vitest';

import { readableShellCommand } from './readableShellCommand';

describe('readableShellCommand', () => {
  it('keeps a plain command as is', () => {
    expect(readableShellCommand('git status')).toBe('git status');
  });

  it('drops output plumbing from every command in a chain', () => {
    expect(
      readableShellCommand(
        'npm view @scope/cli version 2>&1 | tail -1; tool --help 2>&1 | head -30; which tool 2>/dev/null',
      ),
    ).toBe('npm view @scope/cli version; tool --help; which tool');
    expect(readableShellCommand('sed -n 1,80p src/a.ts 2>&1 | head -40')).toBe(
      'sed -n 1,80p src/a.ts',
    );
  });

  it('keeps a filter that changes what the command shows', () => {
    expect(readableShellCommand("gh api repos/a/b | sed -n '/^## Install/,$p'")).toBe(
      "gh api repos/a/b | sed -n '/^## Install/,$p'",
    );
    expect(readableShellCommand('git log | head -n 5 | wc -l')).toBe('git log | head -n 5 | wc -l');
  });

  it('drops setup statements that only prepare the command after them', () => {
    expect(
      readableShellCommand(
        'cd /work/repo-worktrees/shared && git commit -q -a --fixup=abc1234 && git push',
      ),
    ).toBe('git commit -q -a --fixup=abc1234 && git push');
    expect(
      readableShellCommand(
        `cd /tmp/acc; S=acc1; A="agent-browser --session $S"; $A click @e25; sleep 2; $A snapshot`,
      ),
    ).toBe('agent-browser --session $S click @e25; sleep 2; agent-browser --session $S snapshot');
    expect(
      readableShellCommand(
        String.raw`cd ~/Library/Application\ Support/App; sqlite3 -readonly app.db ".tables"`,
      ),
    ).toBe('sqlite3 -readonly app.db ".tables"');
    expect(
      readableShellCommand('export CI=1 FORCE=1 && sleep 20; . /tmp/lib.sh; gh pr checks 14'),
    ).toBe('gh pr checks 14');
    expect(
      readableShellCommand(
        'set -a && source .env && set +a && npx tsx scripts/gross-margin/monthly.ts 2>/dev/null',
      ),
    ).toBe('npx tsx scripts/gross-margin/monthly.ts');
    expect(readableShellCommand("cd 'dir with space'\nbun run check")).toBe('bun run check');
  });

  it('keeps a setup statement that is the whole command or only an environment prefix', () => {
    expect(readableShellCommand('cd src')).toBe('cd src');
    expect(readableShellCommand('CI=1 bun run test')).toBe('CI=1 bun run test');
  });

  it('names a heredoc by the line that opens it, not its body', () => {
    expect(
      readableShellCommand(
        "cd /work/repo && python3 - <<'EOF'\np='packages/a.ts'\ns=open(p).read()\nEOF",
      ),
    ).toBe("python3 - <<'EOF'");
    expect(
      readableShellCommand(
        "cd /repo && mkdir -p src && cat > src/LimitReachedIcon.tsx <<'EOF'\nexport const A = 1;\nEOF",
      ),
    ).toBe("cat > src/LimitReachedIcon.tsx <<'EOF'");
    expect(readableShellCommand('cat > notes.md <<-MD\n# Notes\n\tMD')).toBe(
      'cat > notes.md <<-MD',
    );
    expect(
      readableShellCommand("python3 - <<'EOF'\nprint(1)\nEOF\nbun run check 2>&1 | tail -5"),
    ).toBe("python3 - <<'EOF'; bun run check");
  });

  it('recognizes a heredoc delimiter that is not a plain word', () => {
    expect(readableShellCommand('cat <<\'END-JSON\'\n{"value": 1}\nEND-JSON\ngit status')).toBe(
      "cat <<'END-JSON'; git status",
    );
    expect(readableShellCommand('cat <<\'END-JSON\'\n{"value":')).toBe("cat <<'END-JSON'");
    expect(readableShellCommand('grep -c x <<< "a b"')).toBe('grep -c x <<< "a b"');
    expect(readableShellCommand('cat <<\\EOF\nhello\nEOF\ngit status')).toBe(
      'cat <<\\EOF; git status',
    );
  });

  it('treats shell syntax inside quotes as an argument', () => {
    expect(readableShellCommand("rg '<<EOF' src\ngit status")).toBe("rg '<<EOF' src; git status");
    expect(readableShellCommand("printf '%s' 'hello | head -5; goodbye'")).toBe(
      "printf '%s' 'hello | head -5; goodbye'",
    );
    expect(readableShellCommand('echo "a 2>&1" 2>&1')).toBe('echo "a 2>&1"');
    expect(readableShellCommand("python3 -c '\nprint(1 << 2)\n'\ngit status")).toBe(
      "python3 -c ' print(1 << 2) '; git status",
    );
  });

  it('keeps the opener line while the heredoc body is still streaming', () => {
    expect(readableShellCommand("cd /repo && python3 - <<'EOF'\nimport json\nprint(")).toBe(
      "python3 - <<'EOF'",
    );
  });

  it('reads a heredoc commit message by its first line', () => {
    expect(
      readableShellCommand(
        `git commit -m "$(cat <<'EOF'\nfix: keep titles short\n\nBody\nEOF\n)" && git push`,
      ),
    ).toBe(`git commit -m 'fix: keep titles short' && git push`);
  });

  it('joins a multi-line command into one line', () => {
    expect(readableShellCommand('for f in a.ts b.ts; do\n  wc -l "$f"\ndone')).toBe(
      'for f in a.ts b.ts; do wc -l "$f"; done',
    );
    expect(readableShellCommand('bunx vitest run \\\n  --silent src/a.test.ts')).toBe(
      'bunx vitest run --silent src/a.test.ts',
    );
    expect(readableShellCommand('git status\ngit diff --stat 2>&1')).toBe(
      'git status; git diff --stat',
    );
  });

  it('unwraps the login-shell wrapper Codex reports', () => {
    expect(readableShellCommand(`/bin/zsh -lc "cd /repo && rg -n \\"a|b\\" src"`)).toBe(
      'rg -n "a|b" src',
    );
    expect(readableShellCommand("bash -lc 'git diff --stat'")).toBe('git diff --stat');
  });
});
