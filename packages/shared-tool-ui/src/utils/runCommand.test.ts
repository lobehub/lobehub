import { describe, expect, it } from 'vitest';

import { findGitHubAuthorizeLink, getRunCommandDisplayCommand } from './runCommand';

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

describe('findGitHubAuthorizeLink', () => {
  it('finds the authorize link the git credential helper prints', () => {
    const stderr = [
      'lh git credential: Connect your GitHub account to LobeHub to push from a shared device.',
      '  https://app.lobehub.com/api/webhooks/github/authorize?returnTo=%2Fsettings%2Fintegrations%2Fgithub',
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    ].join('\n');

    expect(findGitHubAuthorizeLink(stderr)).toBe(
      'https://app.lobehub.com/api/webhooks/github/authorize?returnTo=%2Fsettings%2Fintegrations%2Fgithub',
    );
  });

  it('ignores output without one', () => {
    expect(findGitHubAuthorizeLink('Everything up-to-date')).toBeUndefined();
    expect(findGitHubAuthorizeLink(undefined)).toBeUndefined();
  });
});
