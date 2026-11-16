import { describe, expect, it } from 'vitest';

import { describeShellCommandTitle as title } from './describeShellCommandTitle';

describe('describeShellCommandTitle', () => {
  describe('exploration', () => {
    it('reads a file read as the files it reads', () => {
      expect(title("sed -n '1,40p' src/app.ts")).toEqual({ action: 'read', subject: 'app.ts' });
      expect(title('sed -n 1,80p src/a.ts 2>&1 | head -40')).toEqual({
        action: 'read',
        subject: 'a.ts',
      });
      expect(title('/bin/zsh -lc "cat docs/a.md docs/b.md"')).toEqual({
        action: 'read',
        subject: 'a.md, b.md',
      });
      expect(title('head -n 40 src/app.ts')).toMatchObject({ subject: 'app.ts' });
      expect(title('cd apps && nl -ba src/app.ts | sed -n 1,20p')).toEqual({
        action: 'read',
        subject: 'app.ts',
      });
      expect(title("sed -n '1,230p' src/config.ts && sed -n '1,220p' src/rotate.ts")).toMatchObject(
        { action: 'read', subject: 'config.ts, rotate.ts' },
      );
      expect(title('cat a.ts; cat a.ts')).toMatchObject({ action: 'read', subject: 'a.ts' });
    });

    it('names the skill when a SKILL.md is read', () => {
      expect(title('cat .agents/skills/review/SKILL.md')).toEqual({
        action: 'useSkill',
        subject: 'review',
      });
      expect(title('cat SKILL.md')).toMatchObject({ action: 'read' });
    });

    it('reads a search as its terms and where it looks', () => {
      expect(title("rg -n -g '*.ts' POLICY_VERSION src/hooks")).toEqual({
        action: 'search',
        subject: 'POLICY_VERSION in hooks',
      });
      expect(title('rg -n "TODO" src')).toEqual({ action: 'search', subject: 'TODO in src' });
      expect(title('grep -rn "foo bar"')).toEqual({ action: 'search', subject: 'foo bar' });
      expect(title(String.raw`grep -n "退回原批次\|APPROVAL_DEV" docs/schema.md`)).toMatchObject({
        subject: '退回原批次, APPROVAL_DEV in schema.md',
      });
      expect(title("rg -n 'useState|useEffect' src")).toMatchObject({
        subject: 'useState, useEffect in src',
      });
      expect(title(String.raw`grep -F 'a\|b' x.ts`)).toMatchObject({
        subject: String.raw`a\|b in x.ts`,
      });
      expect(title('rtk rg -n TODO src')).toMatchObject({ subject: 'TODO in src' });
      expect(title(String.raw`rg --files scripts/rotation | rg '\.test\.ts'"$"''`)).toEqual({
        action: 'findFiles',
        subject: '.test.ts$ in rotation',
      });
    });

    it('reads a listing as the folder it lists', () => {
      expect(title('rg --files src')).toEqual({ action: 'list', subject: 'src' });
      expect(title('ls')).toEqual({ action: 'listFiles' });
      expect(title('find . -name "*.ts"')).toEqual({ action: 'listFiles' });
    });

    it('keeps an in-place sed a plain command', () => {
      // `-i.bak` and `--in-place` used to read as "读取 app.ts" while rewriting it.
      expect(title("sed -n -i 's/a/b/p' app.ts")).toBeUndefined();
      expect(title("sed -n -i.bak 's/a/b/p' app.ts")).toBeUndefined();
      expect(title("sed -ni 's/a/b/p' app.ts")).toBeUndefined();
      expect(title("sed -n --in-place 's/a/b/p' app.ts")).toBeUndefined();
      expect(title("sed -n --in-place=.bak 's/a/b/p' app.ts")).toBeUndefined();
    });

    it('keeps a read whose sed script writes or runs a command a plain command', () => {
      expect(title("sed -n 'w out.ts' app.ts")).toBeUndefined();
      expect(title("sed -n 's/a/b/w out.ts' app.ts")).toBeUndefined();
      expect(title("sed -n '1e date' app.ts")).toBeUndefined();
    });

    it('keeps a pipeline whose filter writes a file a plain command', () => {
      // `sort -o` used to read as "读取 a.ts" while overwriting b.ts.
      expect(title('cat src/a.ts | sort -o src/b.ts')).toBeUndefined();
      expect(title('cat src/a.ts | sort --output=src/b.ts')).toBeUndefined();
      expect(title('cat src/a.ts | sort -uo src/b.ts')).toBeUndefined();
      expect(title('cat src/a.ts | uniq - src/b.ts')).toBeUndefined();
      expect(title("cat src/a.ts | sed -i 's/a/b/' src/b.ts")).toBeUndefined();
      expect(title("cat src/a.ts | sed 's/a/b/w src/b.ts'")).toBeUndefined();
      // Pure filters still read.
      expect(title("cat src/a.ts | sort -u | uniq -c | sed 's/a/b/g' | head -5")).toEqual({
        action: 'read',
        subject: 'a.ts',
      });
    });

    it('keeps a find or fd that deletes or runs commands a plain command', () => {
      // `find -delete` used to read as "列出文件" while it removed files.
      expect(title('find . -name "*.tmp" -delete')).toBeUndefined();
      expect(title('find . -name "*.ts" -exec wc -l +')).toBeUndefined();
      expect(title('fd -e tmp -x rm')).toBeUndefined();
      expect(title('fd -e tmp --exec-batch=rm')).toBeUndefined();
    });

    it('reads backslash-escaped spaces as part of one word', () => {
      // Used to split into "Release, Notes.md".
      expect(title(String.raw`cat docs/Release\ Notes.md`)).toEqual({
        action: 'read',
        subject: 'Release Notes.md',
      });
      expect(title(String.raw`rg -n foo\ bar src`)).toEqual({
        action: 'search',
        subject: 'foo bar in src',
      });
      expect(title(String.raw`cat "docs/a\"b.md"`)).toMatchObject({ subject: 'a"b.md' });
      // A line continuation is not a word: this used to read "\n in TODO".
      expect(title('rg \\\n  -n TODO src')).toEqual({ action: 'search', subject: 'TODO in src' });
    });

    it('reads every pattern given as an option, and none read from a file', () => {
      // Only the last `-e` used to be kept.
      expect(title('rg -n -e TODO -e FIXME src')).toEqual({
        action: 'search',
        subject: 'TODO, FIXME in src',
      });
      expect(title('rg -n --regexp=TODO src')).toEqual({
        action: 'search',
        subject: 'TODO in src',
      });
      expect(title('grep -rn --regexp TODO src')).toEqual({
        action: 'search',
        subject: 'TODO in src',
      });
      // `-f` used to make `src` read as the pattern.
      expect(title('rg -n -f patterns.txt src')).toBeUndefined();
      expect(title('grep -rn --file=patterns.txt src')).toBeUndefined();
    });

    it('keeps different explorations chained together a plain command', () => {
      expect(title('cat a.ts && rg TODO')).toBeUndefined();
    });
  });

  describe('test runs', () => {
    it('reads a test run by its targets, through rtk and package runners', () => {
      expect(title('rtk vitest run src/a.test.ts src/b.test.ts')).toEqual({
        action: 'runTests',
        subject: 'a.test.ts, b.test.ts',
      });
      expect(title("bunx vitest run --silent='passed-only' src/foo.test.ts")).toEqual({
        action: 'runTests',
        subject: 'foo.test.ts',
      });
      expect(title('bunx vitest run -t "parses" -c vitest.config.ts src/a.test.ts')).toMatchObject({
        subject: 'a.test.ts',
      });
      expect(title('CI=1 pnpm test:unit')).toEqual({
        action: 'runTests',
        subject: 'pnpm test:unit',
      });
      for (const command of [
        'bun run test',
        'npm test',
        'bun test',
        'pnpm vitest',
        'uv run pytest tests/unit',
        'python -m pytest -k slow',
        'go test ./...',
        'cargo test',
        'bunx playwright test e2e/app.e2e.ts',
        'cd apps/server && rtk vitest run src/a.test.ts 2>&1 | tail -20',
      ])
        expect(title(command), command).toMatchObject({ action: 'runTests' });
      expect(title('go test ./internal/...')).toMatchObject({ subject: './internal/...' });
    });

    it('keeps a command that only looks like a test run', () => {
      for (const command of ['vitest bench', 'playwright install', 'bun scripts/test.ts'])
        expect(title(command), command).toBeUndefined();
    });
  });

  describe('Git', () => {
    it('reads a commit or push with its message or branch', () => {
      expect(title('git add -A && rtk git commit -m "fix(chat): stop waiting"')).toEqual({
        action: 'commit',
        isProse: true,
        subject: 'fix(chat): stop waiting',
      });
      expect(
        title(
          'git commit -m "$(cat <<\'EOF\'\nfeat: steer while waiting\n\nBody text.\nEOF\n)" && git push',
        ),
      ).toMatchObject({ action: 'commitAndPush', subject: 'feat: steer while waiting' });
      expect(title('rtk git push -u origin feat/wait-steer')).toEqual({
        action: 'push',
        subject: 'feat/wait-steer',
      });
      expect(
        title("git add -A && git commit -q -F - <<'EOF'\nfix: keep titles short\n\nBody\nEOF"),
      ).toMatchObject({ action: 'commit', subject: 'fix: keep titles short' });
    });

    it('keeps other Git commands a plain command', () => {
      for (const command of ['git status', 'git commit --amend && rm -rf out'])
        expect(title(command), command).toBeUndefined();
    });
  });

  describe('gh, vc and lh', () => {
    it('names pull request steps', () => {
      expect(
        title('gh pr create --base main --title "Steer while waiting" --body-file /tmp/body.md'),
      ).toEqual({ action: 'pr.create', isProse: true, subject: 'Steer while waiting' });
      expect(title('rtk gh pr merge 2383 --squash')).toEqual({
        action: 'pr.merge',
        subject: '#2383',
      });
      expect(title('gh pr checks https://github.com/owner/project/pull/12 --watch')).toEqual({
        action: 'pr.check',
        subject: '#12',
      });
      expect(title('gh pr list --search "tool rows"')).toMatchObject({
        action: 'pr.list',
        subject: 'tool rows',
      });
    });

    it('reads a command whose captured output is read back as that command', () => {
      for (const command of [
        'cd /work/app && gh pr checks 31 --watch > /tmp/ci.log 2>&1; tail -15 /tmp/ci.log',
        'gh pr checks 31 --watch --interval 20 &> ci.log && cat ci.log',
      ])
        expect(title(command), command).toEqual({ action: 'pr.check', subject: '#31' });
      for (const command of [
        'gh pr checks 31 --watch > /tmp/ci.log',
        'gh pr checks 31 --watch > /tmp/ci.log; tail -15 /tmp/other.log',
      ])
        expect(title(command), command).toBeUndefined();
    });

    it('names issue, CI, API, deployment and acceptance steps', () => {
      const cases: Array<[string, { action: string; subject?: string }]> = [
        ['cd ~/code/app && gh issue view 12 --comments', { action: 'issue.view', subject: '#12' }],
        [
          'gh issue view https://github.com/owner/app/issues/34',
          { action: 'issue.view', subject: '#34' },
        ],
        [
          'gh issue list --repo owner/app --search "login loop" --limit 10',
          { action: 'issue.list', subject: 'login loop' },
        ],
        [
          'gh issue create --title "Fix the login loop" --body-file /tmp/b.md',
          { action: 'issue.create', subject: 'Fix the login loop' },
        ],
        ['gh issue comment 5 --body-file /tmp/c.md', { action: 'issue.comment', subject: '#5' }],
        ['gh run view 123456 --log-failed', { action: 'ci.logs', subject: '123456' }],
        ['rtk gh run watch 123456', { action: 'ci.view', subject: '123456' }],
        ['gh run list --branch feat/x --limit 5', { action: 'ci.list', subject: 'feat/x' }],
        ['gh run rerun 99 --failed', { action: 'ci.rerun', subject: '99' }],
        [
          "gh api repos/owner/app/pulls/12/comments --jq '.[].body' | jq length",
          { action: 'githubApi', subject: 'owner/app/pulls/12/comments' },
        ],
        [
          "gh api graphql -f query='query { viewer { login } }'",
          { action: 'githubApi', subject: 'GraphQL' },
        ],
        [
          'vc inspect https://example.vercel.app --scope team',
          { action: 'vercel.inspect', subject: 'example.vercel.app' },
        ],
        ['vc logs dpl_123', { action: 'vercel.logs', subject: 'dpl_123' }],
        ['vc env ls production', { action: 'vercel.envList', subject: 'production' }],
        ['lh acceptance preflight --json', { action: 'acceptance.preflight' }],
        ['lh acceptance view acc_1 --json', { action: 'acceptance.view', subject: 'acc_1' }],
        [
          'cd ~/code/app && lh acceptance run ingest --dir .records/x',
          { action: 'acceptance.ingest' },
        ],
      ];
      for (const [command, expected] of cases)
        expect(title(command), command).toMatchObject(expected);
    });

    it('keeps a subcommand with no dedicated title a plain command', () => {
      expect(title('cd ~/code/app && gh label list --repo owner/app')).toBeUndefined();
    });
  });

  describe('inline scripts', () => {
    it('names the language of a heredoc script instead of its code', () => {
      expect(title("cd /work/repo && python3 - <<'EOF'\nprint(1)\nEOF")).toEqual({
        action: 'runScript.python',
      });
      expect(title("python3 -I - <<'PY'\nprint(1)\nPY")).toEqual({ action: 'runScript.python' });
      expect(title("uv run --with rich python - <<'EOF'\nprint(1)\nEOF")).toEqual({
        action: 'runScript.python',
      });
      expect(title("node <<'JS'\nconsole.log(1)\nJS")).toEqual({ action: 'runScript.node' });
      expect(title("bash <<'SH'\nls\nSH")).toEqual({ action: 'runScript.shell' });
      expect(title("python3 - <<'END-JSON'\nprint(1)\nEND-JSON")).toEqual({
        action: 'runScript.python',
      });
    });

    it('names a script passed as one argument', () => {
      expect(title(`python3 -c "import json; print(json.load(open('a.json')))"`)).toEqual({
        action: 'runScript.python',
      });
      expect(title(`perl -0pi -e 's/a/b/g' src/app.ts`)).toEqual({ action: 'runScript.perl' });
      expect(title(`bun -e 'console.log(1)'`)).toEqual({ action: 'runScript.bun' });
    });

    it('keeps a shell -c wrapper and a script file as the command line', () => {
      expect(title(`zsh -i -c 'echo $PATH'`)).toBeUndefined();
      expect(title('python3 tools/report.py --json')).toBeUndefined();
    });

    it('shows the comment a script opens with', () => {
      expect(title("python3 - <<'EOF'\n# Count rows per session\nprint(1)\nEOF")).toEqual({
        action: 'runScript.python',
        isProse: true,
        subject: 'Count rows per session',
      });
    });

    it('shows what runs after the script', () => {
      expect(title("python3 - <<'EOF'\nprint(1)\nEOF\nbun run check")).toEqual({
        action: 'runScript.python',
        subject: '→ bun run check',
      });
      expect(title(`python3 -c 'print(1)' && git diff --stat`)).toMatchObject({
        subject: '→ git diff --stat',
      });
      expect(title("python3 - <<'EOF' && echo ok\nprint(1)\nEOF\nls")).toMatchObject({
        subject: '→ ls',
      });
    });

    it('reads repeated scripts as one and drops progress echoes', () => {
      expect(
        title("python3 - <<'A'\nprint(1)\nA\npython3 - <<'B'\nprint(2)\nB\ncat types.ts"),
      ).toMatchObject({ action: 'runScript.python', subject: '→ cat types.ts' });
      expect(title("python3 - <<'EOF'\nprint(1)\nEOF\necho done")).toEqual({
        action: 'runScript.python',
      });
    });

    it('waits for a streaming heredoc to finish before naming it', () => {
      expect(title("python3 - <<'EOF'\nprint(1)")).toBeUndefined();
    });
  });

  describe('heredoc file writes', () => {
    it('reads as a write of that file', () => {
      expect(title("cat > a.md <<'EOF'\n# Title\nEOF")).toEqual({
        action: 'write',
        subject: 'a.md',
      });
      expect(title("cat >> /tmp/run/ledger.md <<'EOF'\nrow\nEOF")).toMatchObject({
        subject: 'ledger.md',
      });
      expect(title('cat <<\'EOF\' > "notes/plan.md"\nx\nEOF')).toMatchObject({
        subject: 'plan.md',
      });
      expect(title("tee -a out.log >/dev/null <<'EOF'\nx\nEOF")).toMatchObject({
        subject: 'out.log',
      });
      expect(
        title(
          "cd /repo && mkdir -p src/components && cat > src/components/LimitReachedIcon.tsx <<'EOF'\nexport {}\nEOF",
        ),
      ).toEqual({ action: 'write', subject: 'LimitReachedIcon.tsx' });
    });

    it('reads a file written for the next command as that command', () => {
      expect(
        title(
          "cat > /tmp/body.md <<'EOF'\nBody\nEOF\ngh issue create --title 'Fix login' --body-file /tmp/body.md",
        ),
      ).toMatchObject({ action: 'issue.create', subject: 'Fix login' });
    });

    it('shows a command it cannot name after the file', () => {
      expect(title("cat >> a.md <<'EOF'\nx\nEOF\ntail -5 a.md | wc -l")).toEqual({
        action: 'write',
        subject: 'a.md → tail -5 a.md | wc -l',
      });
    });
  });

  it('keeps any other command a plain command', () => {
    for (const command of [
      'bun run build',
      'cat a.ts > b.ts',
      "sed -i 's/a/b/' app.ts",
      'sed s/a/b/ app.ts',
      'cat app.ts | bun run format',
      'ls && rm -rf build',
      'cat $FILE',
      'cat',
      'for f in a.ts b.ts; do wc -l "$f"; done',
    ])
      expect(title(command), command).toBeUndefined();
  });
});
