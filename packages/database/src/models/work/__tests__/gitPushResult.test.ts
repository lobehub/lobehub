import { describe, expect, it } from 'vitest';

import { parseGithubRemoteUrl, parseGitPushResult } from '../gitPushResult';

describe('parseGithubRemoteUrl', () => {
  it.each([
    ['https://github.com/lobehub/lobehub.git', 'lobehub/lobehub'],
    ['https://github.com/lobehub/lobehub', 'lobehub/lobehub'],
    ['https://x-access-token:abc@github.com/lobehub/lobe-chat.git', 'lobehub/lobe-chat'],
    ['git@github.com:lobehub/lobehub.git', 'lobehub/lobehub'],
    ['ssh://git@github.com/lobehub/lobehub.git', 'lobehub/lobehub'],
  ])('reads %s', (url, repo) => {
    expect(parseGithubRemoteUrl(url)).toBe(repo);
  });

  it('rejects non-GitHub remotes', () => {
    expect(parseGithubRemoteUrl('https://gitlab.com/a/b.git')).toBeNull();
    expect(parseGithubRemoteUrl('/tmp/repo.git')).toBeNull();
  });
});

describe('parseGitPushResult', () => {
  it('reads the repository and published branches of a push', () => {
    expect(
      parseGitPushResult({
        command: 'git push -u origin HEAD',
        output: [
          'remote: Resolving deltas: 100% (2/2)',
          'To github.com:lobehub/lobehub.git',
          ' * [new branch]      worktree-feat+x -> feat/x',
          "branch 'worktree-feat+x' set up to track 'origin/feat/x'.",
        ].join('\n'),
      }),
    ).toEqual({ branches: ['feat/x'], repoFullName: 'lobehub/lobehub' });
  });

  it('accepts fast-forward and forced updates', () => {
    expect(
      parseGitPushResult({
        command: 'git add -A && git commit -m wip && git push --force-with-lease',
        output: [
          'To https://github.com/lobehub/lobehub.git',
          ' + 031bf96...f6b1c2a feat/y -> feat/y (forced update)',
          '   031bf96..f6b1c2a  feat/z -> refs/heads/feat/z',
        ].join('\n'),
      })?.branches,
    ).toEqual(['feat/y', 'feat/z']);
  });

  it('accepts git global options before push', () => {
    expect(
      parseGitPushResult({
        command: 'git -C /tmp/repo push',
        output: 'To github.com:a/b.git\n   1234abc..5678def  main -> main',
      }),
    ).toEqual({ branches: ['main'], repoFullName: 'a/b' });
  });

  it('ignores rejected, deleted and tag refs', () => {
    expect(
      parseGitPushResult({
        command: 'git push origin --all --tags',
        output: [
          'To github.com:a/b.git',
          ' ! [rejected]        feat/x -> feat/x (non-fast-forward)',
          ' - [deleted]         old',
          ' * [new tag]         v1.0.0 -> v1.0.0',
        ].join('\n'),
      }),
    ).toBeNull();
  });

  it('does not attribute a push to two remotes', () => {
    expect(
      parseGitPushResult({
        command: 'git push origin feat && git push fork feat',
        output: [
          'To github.com:a/b.git',
          ' * [new branch]      feat -> feat',
          'To github.com:me/b.git',
          ' * [new branch]      feat -> feat',
        ].join('\n'),
      }),
    ).toBeNull();
  });

  it('needs a git push command and a GitHub destination', () => {
    const output = 'To github.com:a/b.git\n * [new branch]      feat -> feat';
    expect(parseGitPushResult({ command: 'git status', output })).toBeNull();
    expect(parseGitPushResult({ command: 'echo git push', output })).toBeNull();
    expect(parseGitPushResult({ command: 'git push', output: '' })).toBeNull();
    expect(
      parseGitPushResult({
        command: 'git push',
        output: 'To gitlab.com:a/b.git\n * [new branch]      feat -> feat',
      }),
    ).toBeNull();
  });

  it('ignores git commands that carry only options, and tag refs pushed by SHA range', () => {
    expect(
      parseGitPushResult({
        command: 'git --version',
        output: 'To github.com:a/b.git\n * [new branch]      feat -> feat',
      }),
    ).toBeNull();
    expect(
      parseGitPushResult({
        command: 'git -c push.default=current push --follow-tags',
        output: [
          'To github.com:a/b.git',
          '   1234abc..5678def  refs/tags/v1 -> refs/tags/v1',
          '   1234abc..5678def  feat -> feat',
        ].join('\n'),
      }),
    ).toEqual({ branches: ['feat'], repoFullName: 'a/b' });
  });

  it('ignores a dry run, which reports the table without publishing', () => {
    const output = 'To github.com:a/b.git\n * [new branch]      feat -> feat';
    expect(parseGitPushResult({ command: 'git push --dry-run origin feat', output })).toBeNull();
    expect(parseGitPushResult({ command: 'git push -un origin feat', output })).toBeNull();
    expect(
      parseGitPushResult({ command: 'git push -n origin feat && git push origin feat', output }),
    ).toEqual({ branches: ['feat'], repoFullName: 'a/b' });
  });
});
