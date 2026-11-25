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

  it('keeps the exit-code diagnostics of a stderr-only failure', () => {
    // Sandbox backends report `output` as stdout, so both are empty here.
    const body = 'Command failed with exit code 2\nStderr:\nboom';
    expect(getRunCommandStdout({ output: '', stderr: 'boom\n', stdout: '' }, body)).toBe(body);
    // New local rows drop the derived `output`, so the body is the fallback.
    expect(getRunCommandStdout({ stderr: 'boom\n', stdout: '' }, body)).toBe(body);
    // Legacy local rows stored `output = stdout + stderr`, i.e. just the stderr.
    expect(getRunCommandStdout({ output: 'boom\n', stderr: 'boom\n', stdout: '' }, body)).toBe(
      body,
    );
  });

  it('keeps a legacy output that differs from the empty stdout', () => {
    expect(
      getRunCommandStdout({ output: 'notice\nboom\n', stderr: 'boom\n', stdout: '' }, 'body'),
    ).toBe('notice\nboom\n');
  });

  it('falls back to the message body when state has no output at all', () => {
    expect(getRunCommandStdout({ stdout: '' }, 'Command failed with exit code 1')).toBe(
      'Command failed with exit code 1',
    );
    expect(getRunCommandStdout(undefined, 'body')).toBe('body');
    expect(getRunCommandStdout(undefined)).toBe('');
  });
});
