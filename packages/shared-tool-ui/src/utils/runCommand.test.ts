import { describe, expect, it } from 'vitest';

import { getRunCommandDisplayCommand, getRunCommandStdout } from './runCommand';

describe('getRunCommandDisplayCommand', () => {
  it('keeps plain commands unchanged', () => {
    expect(getRunCommandDisplayCommand('git status --short')).toBe('git status --short');
  });

  it('unwraps zsh login shell commands', () => {
    expect(getRunCommandDisplayCommand("/bin/zsh -lc 'git diff --stat'")).toBe('git diff --stat');
  });

  it('unwraps double-quoted bash commands', () => {
    expect(getRunCommandDisplayCommand('/bin/bash -lc "git commit -m \\"fix\\""')).toBe(
      'git commit -m "fix"',
    );
  });

  it('unwraps env shell commands', () => {
    expect(getRunCommandDisplayCommand("/usr/bin/env zsh -lc 'bun run type-check'")).toBe(
      'bun run type-check',
    );
  });

  it('supports sh -c wrappers', () => {
    expect(getRunCommandDisplayCommand("sh -c 'printf ok'")).toBe('printf ok');
  });
});

describe('getRunCommandStdout', () => {
  it('reads stdout from rows that no longer store output', () => {
    expect(getRunCommandStdout({ stdout: 'hello\n' }, 'Command completed successfully.')).toBe(
      'hello\n',
    );
  });

  it('prefers stdout on legacy rows that stored both copies', () => {
    expect(
      getRunCommandStdout({ output: 'out\nerr\n', stderr: 'err\n', stdout: 'out\n' }, 'body'),
    ).toBe('out\n');
  });

  it('falls back to output on legacy rows without stdout', () => {
    expect(getRunCommandStdout({ output: 'only output' }, 'body')).toBe('only output');
  });

  it('shows nothing extra when stdout is empty and stderr is rendered on its own', () => {
    expect(getRunCommandStdout({ output: 'boom\n', stderr: 'boom\n', stdout: '' }, 'body')).toBe(
      '',
    );
  });

  it('falls back to the message body when state has no output at all', () => {
    expect(getRunCommandStdout({ stdout: '' }, 'Command failed with exit code 1')).toBe(
      'Command failed with exit code 1',
    );
    expect(getRunCommandStdout(undefined, 'body')).toBe('body');
    expect(getRunCommandStdout(undefined)).toBe('');
  });
});
