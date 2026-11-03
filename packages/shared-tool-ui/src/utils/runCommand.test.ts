import { describe, expect, it } from 'vitest';

import { getRunCommandDisplayCommand } from './runCommand';

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
