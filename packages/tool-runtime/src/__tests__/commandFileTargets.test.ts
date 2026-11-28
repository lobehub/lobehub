import { describe, expect, it } from 'vitest';

import { extractCommandFileTargets } from '../commandFileTargets';

const paths = (command: string) => extractCommandFileTargets(command).map((target) => target.path);

describe('extractCommandFileTargets', () => {
  it('reads the operands of read commands, skipping options and counts', () => {
    expect(paths('cat -n a.ts b.ts')).toEqual(['a.ts', 'b.ts']);
    expect(paths('head -n 20 src/a.ts')).toEqual(['src/a.ts']);
    expect(paths('tail -50 log.txt')).toEqual(['log.txt']);
    expect(paths("sed -n '1,40p' /other/repo/AGENTS.md")).toEqual(['/other/repo/AGENTS.md']);
    expect(paths('sed -e s/a/b/ -e s/c/d/ x.md')).toEqual(['x.md']);
  });

  it('marks cd targets as directories and resolves later relative paths against them', () => {
    expect(extractCommandFileTargets('cd packages/web && cat src/app.ts')).toEqual([
      { kind: 'dir', path: 'packages/web' },
      { kind: 'file', path: 'packages/web/src/app.ts' },
    ]);
    expect(paths('cd /other/repo && cat /abs/a.ts')).toEqual(['/other/repo', '/abs/a.ts']);
  });

  it('splits at a semicolon glued to a word', () => {
    expect(extractCommandFileTargets('cd pkg; cat a.ts')).toEqual([
      { kind: 'dir', path: 'pkg' },
      { kind: 'file', path: 'pkg/a.ts' },
    ]);
    expect(paths('cat a; cat b >> c')).toEqual(['a', 'b', 'c']);
  });

  it('drops relative paths after a cd it cannot follow', () => {
    expect(paths('cd $HOME/x && cat a.ts /abs/b.ts')).toEqual(['/abs/b.ts']);
    expect(paths('cd - && cat a.ts')).toEqual([]);
    expect(paths('cd $X && cd /repo && cat a.ts')).toEqual(['/repo', '/repo/a.ts']);
  });

  it('takes output redirect targets and tee operands as files', () => {
    expect(paths('echo x > out.md')).toEqual(['out.md']);
    expect(paths('cat < in.txt')).toEqual(['in.txt']);
    expect(paths('echo x >>out.md 2>&1')).toEqual(['out.md']);
    expect(paths('pnpm test 2>/dev/null | tee log/test.txt')).toEqual(['log/test.txt']);
  });

  it('looks through env assignments, command prefixes and shell wrappers', () => {
    expect(paths('FOO=1 sudo cat /etc/hosts')).toEqual(['/etc/hosts']);
    expect(paths("bash -lc 'cd pkg && cat a.ts'")).toEqual(['pkg', 'pkg/a.ts']);
  });

  it('ignores searches, unexpanded paths and unparsable commands', () => {
    expect(paths('grep -rn foo packages')).toEqual([]);
    expect(paths('ls packages/web')).toEqual([]);
    expect(paths('cat $HOME/a.ts src/*.ts')).toEqual([]);
    expect(paths("cat 'unterminated")).toEqual([]);
  });

  it('caps the number of targets', () => {
    expect(paths('cat a b c d e f g')).toHaveLength(5);
  });
});
