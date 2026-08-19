import { readdir, readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getGitBranch, getLinkedPullRequest } from '../info';

const childProcessMocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: childProcessMocks.execFileAsync,
  });

  return { execFile };
});

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

const ok = (stdout: string) => ({ stderr: '', stdout });

const PULL_REQUEST = {
  headRefName: 'feat/hetero-session-import-ui',
  headRepository: { nameWithOwner: 'lobehub/lobehub' },
  headRepositoryOwner: { login: 'lobehub' },
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  mergedAt: '2026-07-07T09:00:00Z',
  number: 17_101,
  reviewDecision: 'APPROVED',
  state: 'OPEN',
  statusCheckRollup: [{ conclusion: 'SUCCESS' }],
  title: 'feat: import local sessions',
  url: 'https://github.com/lobehub/lobehub/pull/17101',
  updatedAt: '2026-07-07T10:00:00Z',
};

const NORMALIZED_PULL_REQUEST = {
  ciStatus: 'success',
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  mergedAt: '2026-07-07T09:00:00Z',
  number: 17_101,
  reviewDecision: 'APPROVED',
  state: 'OPEN',
  title: 'feat: import local sessions',
  url: 'https://github.com/lobehub/lobehub/pull/17101',
};

interface ShellFixture {
  /** Remote refs whose tips are ancestors of the current local branch tip. */
  ancestorRefs?: string[];
  /** `for-each-ref` → sha, upstream remote/ref, push remote/tracking ref/remote ref. */
  branchRef?: string;
  /** The branch's commit is already contained in the remote default branch (fork point). */
  commitOnDefault?: boolean;
  /** `gh api repos/{owner}/{repo}/commits/<sha>/pulls`. */
  defaultBranch?: Record<string, string>;
  parentRepo?: string;
  /** `gh pr list --head`. */
  prList?: unknown[];
  /** `gh pr view <n>`. */
  prView?: unknown;
  pushDefault?: string;
  /** Refs this repo pushed to — git writes `update by push` into their reflog. */
  pushedRefs?: string[];
  pushRefspec?: string;
  refsAt?: string[];
  remoteRefs?: string[];
  remotes?: string[];
  remoteUrl?: string;
  /** `<local ref>\t<upstream ref>` rows for branches with configured upstreams. */
  trackedRefs?: string[];
}

/**
 * A branch published under a different remote name, with every signal real git would
 * leave behind: the tracking ref sits on the commit, its reflog records the push, and
 * the branch tracks it.
 */
const publishedAs = (ref: string) => ({
  branchRef: `sha1\torigin\t${ref}`,
  pushedRefs: [ref],
  refsAt: [ref],
});

const mockShell = ({
  ancestorRefs = [],
  branchRef = '',
  commitOnDefault = false,
  defaultBranch = { origin: 'origin/canary' },
  prList = [],
  prView,
  pushedRefs = [],
  refsAt = [],
  remotes = ['origin'],
  remoteRefs = [],
  trackedRefs = [],
  parentRepo,
  pushDefault = '',
  pushRefspec = '',
  remoteUrl = 'git@github.com:lobehub/lobehub.git',
}: ShellFixture) => {
  childProcessMocks.execFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
    if (cmd === 'git') {
      const [subcommand] = args;
      if (subcommand === 'remote' && args[1] === 'get-url') return ok(remoteUrl);
      if (subcommand === 'remote') return ok(remotes.join('\n'));
      if (subcommand === 'config') {
        return ok(args.includes('push.default') ? pushDefault : pushRefspec);
      }
      if (subcommand === 'merge-base') {
        // `--is-ancestor` reports through the exit status: 0 = contained, 1 = not.
        const isAncestor =
          ancestorRefs.includes(args[2]) ||
          refsAt.includes(args[2]) ||
          (commitOnDefault && args[3]?.startsWith('refs/remotes/'));
        if (!isAncestor) throw Object.assign(new Error('not an ancestor'), { code: 1 });
        return ok('');
      }
      if (subcommand === 'reflog') {
        const ref = args[2];
        return ok(pushedRefs.includes(ref) ? `abc1234 ${ref}@{0}: update by push` : '');
      }
      if (subcommand === 'symbolic-ref') {
        const remote = args[2].replace('refs/remotes/', '').replace('/HEAD', '');
        const target = defaultBranch[remote];
        if (!target) throw new Error('fatal: not a symbolic ref');
        return ok(target);
      }
      if (subcommand === 'for-each-ref') {
        if (args.includes('--points-at')) return ok(refsAt.join('\n'));
        if (args.at(-1) === 'refs/heads') return ok(trackedRefs.join('\n'));
        if (args.includes('--format=%(refname)')) return ok(remoteRefs.join('\n'));
        return ok(branchRef);
      }
    }

    if (cmd === 'gh') {
      if (args[0] === 'api') {
        return ok(JSON.stringify({ parent: parentRepo ? { full_name: parentRepo } : undefined }));
      }
      if (args[1] === 'list') return ok(JSON.stringify(prList));
      if (args[1] === 'view') return ok(JSON.stringify(prView ?? {}));
    }

    throw new Error(`unexpected: ${cmd} ${args.join(' ')}`);
  });
};

/** Args of every `gh` invocation, so a test can assert what was — and wasn't — asked. */
const ghCalls = (): string[][] =>
  childProcessMocks.execFileAsync.mock.calls
    .filter(([cmd]) => cmd === 'gh')
    .map(([, args]) => args as string[]);

describe('getLinkedPullRequest', () => {
  beforeEach(() => {
    childProcessMocks.execFileAsync.mockReset();
  });

  it('queries the preserved PR number directly when provided', async () => {
    mockShell({ branchRef: 'sha1\t\t', prView: { ...PULL_REQUEST, state: 'MERGED' } });

    const result = await getLinkedPullRequest({
      branch: 'fix/topic-running',
      path: '/repo',
      pullRequestNumber: 17_101,
    });

    expect(ghCalls()).toEqual([['pr', 'view', '17101', '--json', expect.any(String)]]);
    expect(result.pullRequest).toMatchObject({
      mergedAt: '2026-07-07T09:00:00Z',
      number: 17_101,
      state: 'MERGED',
    });
  });

  it('discovers only open PRs with the published owner and branch', async () => {
    mockShell({
      branchRef: 'sha1\torigin\trefs/remotes/origin/fix/topic-running',
      pushedRefs: ['refs/remotes/origin/fix/topic-running'],
      refsAt: ['refs/remotes/origin/fix/topic-running'],
      prList: [
        {
          ...PULL_REQUEST,
          headRefName: 'fix/topic-running',
          headRepository: { nameWithOwner: 'lobehub/lobehub' },
        },
        {
          ...PULL_REQUEST,
          headRefName: 'fix/topic-running',
          headRepository: { nameWithOwner: 'another-fork/lobehub' },
          number: 99,
        },
      ],
    });

    const result = await getLinkedPullRequest({ branch: 'fix/topic-running', path: '/repo' });

    expect(childProcessMocks.execFileAsync).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--head', 'fix/topic-running', '--state', 'open', '--limit', '1000']),
      { cwd: '/repo', timeout: 8000 },
    );
    expect(result).toEqual({
      extraCount: 0,
      pullRequest: NORMALIZED_PULL_REQUEST,
      pullRequests: [NORMALIZED_PULL_REQUEST],
      status: 'ok',
      upstream: { branch: 'fix/topic-running', remote: 'origin' },
    });
  });

  // The reported bug. The local branch name never existed on the remote, so asking
  // `gh` about it returned an empty list forever and the PR silently never linked.
  it('queries the head branch that exists on the REMOTE, not the local branch name', async () => {
    mockShell({
      ...publishedAs('refs/remotes/origin/feat/hetero-session-import-ui'),
      prList: [PULL_REQUEST],
    });

    const result = await getLinkedPullRequest({
      branch: 'worktree-feat+claude-code-session-import',
      path: '/repo',
    });

    const listArgs = ghCalls().find((args) => args[1] === 'list')!;
    expect(listArgs).toContain('feat/hetero-session-import-ui');
    expect(listArgs).not.toContain('worktree-feat+claude-code-session-import');

    expect(result.pullRequest).toMatchObject({ number: 17_101 });
    expect(result.upstream).toEqual({
      branch: 'feat/hetero-session-import-ui',
      remote: 'origin',
    });
  });

  it('keeps discovering a pushed untracked branch after an additional local commit', async () => {
    mockShell({
      ancestorRefs: ['refs/remotes/origin/feat/hetero-session-import-ui'],
      branchRef: 'sha2\t\t',
      prList: [PULL_REQUEST],
      pushedRefs: ['refs/remotes/origin/feat/hetero-session-import-ui'],
      remoteRefs: ['refs/remotes/origin/feat/hetero-session-import-ui'],
    });

    const result = await getLinkedPullRequest({
      branch: 'feat/hetero-session-import-ui',
      path: '/repo',
    });

    expect(result.pullRequest?.number).toBe(17_101);
    expect(result.upstream).toEqual({
      branch: 'feat/hetero-session-import-ui',
      remote: 'origin',
    });
  });

  it('queries a fork parent and returns every open PR by updated time', async () => {
    const older = { ...PULL_REQUEST, number: 10, updatedAt: '2026-07-01T00:00:00Z' };
    const newer = {
      ...PULL_REQUEST,
      number: 20,
      updatedAt: '2026-07-10T00:00:00Z',
      url: 'https://github.com/lobehub/lobehub/pull/20',
    };
    mockShell({
      ...publishedAs('refs/remotes/origin/feat/hetero-session-import-ui'),
      parentRepo: 'upstream/lobehub',
      prList: [older, newer],
    });

    const result = await getLinkedPullRequest({
      branch: 'worktree-feat+x',
      path: '/repo',
    });

    const queriedRepos = ghCalls()
      .filter((args) => args[1] === 'list')
      .map((args) => args[args.indexOf('--repo') + 1]);
    expect(queriedRepos).toEqual(['lobehub/lobehub', 'upstream/lobehub']);
    expect(result.pullRequests?.map(({ number }) => number)).toEqual([20, 10]);
    expect(result.pullRequest?.number).toBe(20);
    expect(result.extraCount).toBe(1);
  });

  it('uses the configured push remote instead of the pull upstream repository', async () => {
    const forkPullRequest = {
      ...PULL_REQUEST,
      headRefName: 'feat/hetero-session-import-ui',
      headRepository: { nameWithOwner: 'contributor/lobehub' },
    };
    mockShell({
      ancestorRefs: ['refs/remotes/fork/feat/hetero-session-import-ui'],
      branchRef: 'sha1\torigin\trefs/remotes/origin/feat/hetero-session-import-ui\tfork\t',
      parentRepo: 'lobehub/lobehub',
      prList: [forkPullRequest],
      pushedRefs: ['refs/remotes/fork/feat/hetero-session-import-ui'],
      remoteUrl: 'git@github.com:contributor/lobehub.git',
    });

    const result = await getLinkedPullRequest({
      branch: 'feat/hetero-session-import-ui',
      path: '/repo',
    });

    expect(childProcessMocks.execFileAsync).toHaveBeenCalledWith(
      'git',
      ['remote', 'get-url', '--push', 'fork'],
      { cwd: '/repo', timeout: 5000 },
    );
    expect(result.pullRequest?.number).toBe(17_101);
    expect(result.upstream).toEqual({
      branch: 'feat/hetero-session-import-ui',
      remote: 'fork',
    });
  });

  it('does not discover a colleague’s fetched PR from an unpushed local branch', async () => {
    mockShell({
      ancestorRefs: ['refs/remotes/origin/feat/hetero-session-import-ui'],
      branchRef:
        'sha1\torigin\trefs/remotes/origin/feat/hetero-session-import-ui\torigin\trefs/remotes/origin/feat/hetero-session-import-ui\t',
      prList: [PULL_REQUEST],
    });

    const result = await getLinkedPullRequest({
      branch: 'feat/hetero-session-import-ui',
      path: '/repo',
    });

    expect(ghCalls()).toEqual([]);
    expect(result).toEqual({ pullRequest: null, status: 'ok' });
  });

  it('uses the push URL repository and rejects closed or inexact repository matches', async () => {
    mockShell({
      ...publishedAs('refs/remotes/origin/feat/hetero-session-import-ui'),
      prList: [
        { ...PULL_REQUEST, state: 'CLOSED' },
        { ...PULL_REQUEST, headRepository: { nameWithOwner: 'lobehub/another-repo' }, number: 2 },
        { ...PULL_REQUEST, headRepository: null, number: 3 },
      ],
      remoteUrl: 'git@github.com:my-fork/lobehub.git',
    });

    const result = await getLinkedPullRequest({ branch: 'worktree-feat+x', path: '/repo' });

    expect(childProcessMocks.execFileAsync).toHaveBeenCalledWith(
      'git',
      ['remote', 'get-url', '--push', 'origin'],
      { cwd: '/repo', timeout: 5000 },
    );
    expect(ghCalls()).toContainEqual(['api', 'repos/my-fork/lobehub']);
    expect(result.pullRequest).toBeNull();
  });

  it('parses an SSH GitHub push URL with an explicit port', async () => {
    mockShell({
      ...publishedAs('refs/remotes/origin/feat/hetero-session-import-ui'),
      prList: [PULL_REQUEST],
      remoteUrl: 'ssh://git@github.com:22/lobehub/lobehub.git',
    });

    const result = await getLinkedPullRequest({ branch: 'worktree-feat+x', path: '/repo' });

    expect(ghCalls()).toContainEqual(['api', 'repos/lobehub/lobehub']);
    expect(result.pullRequest?.number).toBe(17_101);
  });

  it('does not guess a PR by commit when no publication ref exists', async () => {
    mockShell({
      branchRef: 'sha1\t\t',
      prList: [],
      prView: PULL_REQUEST,
    });

    const result = await getLinkedPullRequest({ branch: 'worktree-feat+x', path: '/repo' });

    expect(ghCalls()).toEqual([]);
    expect(result).toEqual({ pullRequest: null, status: 'ok' });
  });

  // An empty list under a RESOLVED remote ref is a real answer — the branch has no PR.
  // Spending a network call to re-ask by commit on every poll would be pure waste.
  it('returns no PR when a published branch has no open PR', async () => {
    mockShell({ ...publishedAs('refs/remotes/origin/feat/y'), prList: [] });

    const result = await getLinkedPullRequest({ branch: 'worktree-feat+x', path: '/repo' });

    expect(result).toEqual({
      pullRequest: null,
      status: 'ok',
      upstream: { branch: 'feat/y', remote: 'origin' },
    });
  });

  it('takes the remote ref from the PR itself when resolving a saved PR number', async () => {
    mockShell({ branchRef: 'sha1\t\t', prView: PULL_REQUEST });

    const result = await getLinkedPullRequest({
      branch: 'worktree-feat+x',
      path: '/repo',
      pullRequestNumber: 17_101,
    });

    expect(result.upstream).toEqual({
      branch: 'feat/hetero-session-import-ui',
      remote: 'origin',
    });
  });

  // `/commits/{sha}/pulls` answers "which PR INTRODUCED this commit". A branch with no
  // commits of its own sits on the commit it forked from — already merged into canary —
  // so asking about it would staple a stranger's merged PR onto a brand-new topic.
  it('never asks GitHub about a commit that is just the fork point', async () => {
    mockShell({
      branchRef: 'sha1\t\t',
      commitOnDefault: true,
      prList: [],
    });

    const result = await getLinkedPullRequest({ branch: 'worktree-fresh', path: '/repo' });

    expect(ghCalls().some((args) => args[0] === 'api')).toBe(false);
    expect(result).toEqual({ pullRequest: null, status: 'ok' });
  });

  // `refs/remotes/<remote>/HEAD` is only written by `git clone`. Without it the fork
  // point cannot be ruled out, and a wrong PR is worse than no PR.
  it('never asks GitHub when the remote default branch is unknown', async () => {
    mockShell({
      branchRef: 'sha1\t\t',
      defaultBranch: {},
      prList: [],
    });

    const result = await getLinkedPullRequest({ branch: 'worktree-fresh', path: '/repo' });

    expect(ghCalls().some((args) => args[0] === 'api')).toBe(false);
    expect(result).toEqual({ pullRequest: null, status: 'ok' });
  });

  // `gh pr list` already proved gh is healthy, so a failing fallback means "no PR",
  // not "lookup broken" — reporting an error would surface a false failure in the UI.
  it('degrades a failing commit lookup to "no PR" rather than an error', async () => {
    mockShell({ branchRef: 'sha1\t\t', prList: [] });

    expect(await getLinkedPullRequest({ branch: 'worktree-feat+x', path: '/repo' })).toEqual({
      pullRequest: null,
      status: 'ok',
    });
  });

  it('reports gh-missing when the gh CLI is unavailable', async () => {
    childProcessMocks.execFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'for-each-ref') {
        return ok('sha1\torigin\trefs/remotes/origin/feat/x\torigin\trefs/remotes/origin/feat/x\t');
      }
      if (cmd === 'git' && args[0] === 'reflog') {
        return ok('sha1 refs/remotes/origin/feat/x@{0}: update by push');
      }
      if (cmd === 'git' && args[0] === 'merge-base') {
        return ok('');
      }
      if (cmd === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
        return ok('git@github.com:lobehub/lobehub.git');
      }
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    });

    expect(await getLinkedPullRequest({ branch: 'feat/x', path: '/repo' })).toEqual({
      pullRequest: null,
      status: 'gh-missing',
    });
  });
});

describe('getGitBranch', () => {
  beforeEach(() => {
    childProcessMocks.execFileAsync.mockReset();
    vi.mocked(readdir).mockReset();
    vi.mocked(readFile).mockReset();
  });

  const mockHead = (head: string) => {
    vi.mocked(readdir).mockResolvedValue(['HEAD'] as never);
    vi.mocked(readFile).mockImplementation(async (target) => {
      if (String(target) === '/repo/.git/HEAD') return head;
      // `.git` is a directory, not a worktree pointer file.
      throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
    });
  };

  it('carries the remote ref alongside the branch', async () => {
    mockHead('ref: refs/heads/worktree-feat+x\n');
    mockShell(publishedAs('refs/remotes/origin/feat/y'));

    expect(await getGitBranch('/repo')).toEqual({
      branch: 'worktree-feat+x',
      upstream: { branch: 'feat/y', remote: 'origin' },
    });
  });

  it('omits the remote ref for an unpushed branch', async () => {
    mockHead('ref: refs/heads/worktree-feat+x\n');
    mockShell({ branchRef: 'sha1\t\t' });

    expect(await getGitBranch('/repo')).toEqual({ branch: 'worktree-feat+x' });
  });

  // A detached HEAD has no branch to publish, so it must not pay for a git subprocess.
  it('stays a pure filesystem read for a detached HEAD', async () => {
    mockHead('a'.repeat(40));
    mockShell({});

    expect(await getGitBranch('/repo')).toEqual({ branch: 'aaaaaaa', detached: true });
    expect(childProcessMocks.execFileAsync).not.toHaveBeenCalled();
  });
});
