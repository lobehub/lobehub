import { describe, expect, it } from 'vitest';

import { normalizeGithubShellToolResult, normalizeGithubToolResult } from '../githubToolResult';

const shell = (
  command: string,
  output = '',
  options: Parameters<typeof normalizeGithubShellToolResult>[1] = { pullRequestLifecycle: true },
) =>
  normalizeGithubShellToolResult(
    { data: { command, exitCode: 0, output }, toolName: 'Bash' },
    options,
  );

describe('normalizeGithubShellToolResult (pull request lifecycle)', () => {
  it('ignores gh pr ready / merge unless the caller opts in', () => {
    expect(
      normalizeGithubShellToolResult({
        data: { command: 'gh pr merge 12 -R lobehub/lobehub --squash', exitCode: 0, output: '' },
        toolName: 'Bash',
      }),
    ).toBeNull();
    expect(shell('gh pr ready 12 -R lobehub/lobehub', '', {})).toBeNull();
  });

  it('marks a merged pull request named by number and --repo once gh confirms the merge', () => {
    const operation = shell(
      'gh pr merge 12 -R lobehub/lobehub --squash --delete-branch',
      '✓ Squashed and merged pull request lobehub/lobehub#12 (Fix tray)',
    );

    expect(operation?.params).toMatchObject({
      changeType: 'updated',
      identifier: 'lobehub/lobehub#12',
      resourceType: 'github_pull_request',
      status: 'merged',
    });
    expect(operation?.params.patchFields).toEqual(['identifier', 'status']);
  });

  it('treats the merge commit -t / -b as the commit, not the pull request', () => {
    const operation = shell(
      `gh pr merge 12 --repo lobehub/lobehub -s -t 'squash subject' -b 'squash body'`,
    );

    expect(operation?.params).toMatchObject({ identifier: 'lobehub/lobehub#12' });
    expect(operation?.params.title).toBeUndefined();
    expect(operation?.params.content).toBeUndefined();
  });

  it('does not let a -m / -r merge switch swallow the number', () => {
    expect(shell('gh pr merge -m 7 -R lobehub/lobehub')?.params.identifier).toBe(
      'lobehub/lobehub#7',
    );
    expect(shell('gh pr merge -r 8 -R lobehub/lobehub')?.params.identifier).toBe(
      'lobehub/lobehub#8',
    );
  });

  it('links an auto-merge request without claiming the pull request merged', () => {
    const operation = shell('gh pr merge 12 -R lobehub/lobehub --auto --squash');

    expect(operation?.params.identifier).toBe('lobehub/lobehub#12');
    expect(operation?.params.status).toBeUndefined();
    expect(operation?.params.patchFields).toEqual(['identifier']);
  });

  it('records ready as open and ready --undo as draft', () => {
    expect(shell('gh pr ready 3 -R lobehub/lobehub')?.params.status).toBe('open');
    expect(shell('gh pr ready 3 -R lobehub/lobehub --undo')?.params.status).toBe('draft');
  });

  it('takes the repository from a pull request URL target', () => {
    const operation = shell('gh pr merge https://github.com/lobehub/lobehub/pull/44 --merge');

    expect(operation?.params).toMatchObject({
      identifier: 'lobehub/lobehub#44',
      url: 'https://github.com/lobehub/lobehub/pull/44',
    });
  });

  it('reads the repository from the terminal confirmation line', () => {
    const operation = shell(
      'gh pr merge 9 --squash',
      '✓ Squashed and merged pull request lobehub/lobehub#9 (Fix tray)\n',
    );

    expect(operation?.params.identifier).toBe('lobehub/lobehub#9');
  });

  it('falls back to the one pull request of that number already linked to the topic', () => {
    expect(
      shell('gh pr ready 9', '', {
        pullRequestLifecycle: true,
        topicPullRequests: ['lobehub/lobehub#9', 'lobehub/other#3'],
      })?.params.identifier,
    ).toBe('lobehub/lobehub#9');
  });

  it('registers nothing when the number cannot be placed in a repository', () => {
    expect(shell('gh pr ready 9', '', { pullRequestLifecycle: true })).toBeNull();
    expect(
      shell('gh pr ready 9', '', {
        pullRequestLifecycle: true,
        topicPullRequests: ['a/one#9', 'b/two#9'],
      }),
    ).toBeNull();
  });

  it('ignores a lifecycle command without a pull request number', () => {
    expect(shell('gh pr merge --squash')).toBeNull();
    expect(
      shell('gh pr ready', '', { pullRequestLifecycle: true, topicPullRequests: [] }),
    ).toBeNull();
  });

  it('trusts the target over URLs a chained segment printed', () => {
    const operation = shell(
      'gh pr merge 5 -R lobehub/lobehub && gh pr list',
      'https://github.com/lobehub/lobehub/pull/99\n',
    );

    expect(operation?.params.identifier).toBe('lobehub/lobehub#5');
  });

  it('never links a pull request that was only viewed, diffed, checked out or reviewed', () => {
    for (const command of [
      'gh pr view 5 -R lobehub/lobehub',
      'gh pr diff 5 -R lobehub/lobehub',
      'gh pr checkout 5 -R lobehub/lobehub',
      'gh pr review 5 -R lobehub/lobehub --approve',
    ]) {
      expect(shell(command, 'https://github.com/lobehub/lobehub/pull/5')).toBeNull();
    }
  });

  it('keeps an edit from overwriting the status', () => {
    const operation = shell(
      `gh pr edit 5 -R lobehub/lobehub --title 'New title'`,
      'https://github.com/lobehub/lobehub/pull/5',
    );

    expect(operation?.params.status).toBeUndefined();
    expect(operation?.params.patchFields).not.toContain('status');
  });

  it('leaves the github skill runCommand surface without lifecycle commands', () => {
    expect(
      normalizeGithubToolResult({
        data: { command: 'gh pr merge 12 -R lobehub/lobehub', exitCode: 0, output: '' },
        toolName: 'runCommand',
      }),
    ).toBeNull();
  });

  it('links but does not claim merged when gh only queued the merge or printed nothing', () => {
    for (const output of [
      '',
      '✓ Pull request lobehub/lobehub#12 will be added to the merge queue for main when ready',
    ]) {
      const operation = shell('gh pr merge 12 -R lobehub/lobehub --squash', output);
      expect(operation?.params.identifier).toBe('lobehub/lobehub#12');
      expect(operation?.params.status).toBeUndefined();
    }
  });
});
