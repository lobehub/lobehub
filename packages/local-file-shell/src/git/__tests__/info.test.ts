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
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  mergedAt: '2026-07-07T09:00:00Z',
  number: 17_101,
  reviewDecision: 'APPROVED',
  state: 'MERGED',
  statusCheckRollup: [{ conclusion: 'SUCCESS' }],
  title: 'feat: import local sessions',
  url: 'https://github.com/lobehub/lobehub/pull/17101',
};

const NORMALIZED_PULL_REQUEST = {
  ciStatus: 'success',
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  mergedAt: '2026-07-07T09:00:00Z',
  number: 17_101,
  reviewDecision: 'APPROVED',
  state: 'MERGED',
  title: 'feat: import local sessions',
  url: 'https://github.com/lobehub/lobehub/pull/17101',
};

interface ShellFixture {
  /** `for-each-ref refs/heads/<branch>` → `<sha>\t<upstream remote>\t<upstream ref>`. */
  branchRef?: string;
  /** The branch's commit is already contained in the remote default branch (fork point). */
  commitOnDefault?: boolean;
  /** `gh api repos/{owner}/{repo}/commits/<sha>/pulls`. */
  commitPulls?: unknown[];
  defaultBranch?: Record<string, string>;
  /** `gh pr list --head`. */
  prList?: unknown[];
  /** `gh pr view <n>`. */
  prView?: unknown;
  /** Refs this repo pushed to — git writes `update by push` into their reflog. */
  pushedRefs?: string[];
  refsAt?: string[];
  remotes?: string[];
  /** Remote refs a local branch tracks (`for-each-ref --format=%(upstream)`). */
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
  trackedRefs: [ref],
});

const mockShell = ({
  branchRef = '',
  commitOnDefault = false,
  commitPulls,
  defaultBranch = { origin: 'origin/canary' },
  prList = [],
  prView,
  pushedRefs = [],
  refsAt = [],
  remotes = ['origin'],
  trackedRefs = [],
}: ShellFixture) => {
  childProcessMocks.execFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
    if (cmd === 'git') {
      const [subcommand] = args;
      if (subcommand === 'remote') return ok(remotes.join('\n'));
      if (subcommand === 'merge-base') {
        // `--is-ancestor` reports through the exit status: 0 = contained, 1 = not.
        if (!commitOnDefault) throw Object.assign(new Error('not an ancestor'), { code: 1 });
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
        if (args.includes('--format=%(upstream)')) return ok(trackedRefs.join('\n'));
        return ok(branchRef);
      }
    }

    if (cmd === 'gh') {
      if (args[0] === 'api') {
        if (!commitPulls) throw new Error('gh api failed');
        return ok(JSON.stringify(commitPulls));
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
    mockShell({ branchRef: 'sha1\t\t', prView: PULL_REQUEST });

    const result = await getLinkedPullRequest({
      branch: 'fix/topic-running',
      path: '/repo',
      pullRequestNumber: 17_101,
    });

    expect(ghCalls()).toEqual([['pr', 'view', '17101', '--json', expect.any(String)]]);
    expect(result.pullRequest).toMatchObject({ mergedAt: '2026-07-07T09:00:00Z', number: 17_101 });
  });

  it('queries all PR states so merged pull requests can refresh topic metadata', async () => {
    mockShell({
      branchRef: 'sha1\torigin\trefs/remotes/origin/fix/topic-running',
      prList: [{ ...PULL_REQUEST, headRefName: 'fix/topic-running' }],
    });

    const result = await getLinkedPullRequest({ branch: 'fix/topic-running', path: '/repo' });

    expect(childProcessMocks.execFileAsync).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--head', 'fix/topic-running', '--state', 'all']),
      { cwd: '/repo', timeout: 8000 },
    );
    expect(result).toEqual({
      extraCount: 0,
      pullRequest: NORMALIZED_PULL_REQUEST,
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

  it('recovers the PR by commit when the push left no local trace of the remote branch', async () => {
    mockShell({
      branchRef: 'sha1\t\t',
      commitPulls: [{ head: { ref: 'feat/hetero-session-import-ui' }, number: 17_101 }],
      prList: [],
      prView: PULL_REQUEST,
    });

    const result = await getLinkedPullRequest({ branch: 'worktree-feat+x', path: '/repo' });

    expect(ghCalls()).toContainEqual(['api', 'repos/{owner}/{repo}/commits/sha1/pulls']);
    expect(result).toEqual({
      pullRequest: NORMALIZED_PULL_REQUEST,
      status: 'ok',
      upstream: { branch: 'feat/hetero-session-import-ui', remote: 'origin' },
    });
  });

  // An empty list under a RESOLVED remote ref is a real answer — the branch has no PR.
  // Spending a network call to re-ask by commit on every poll would be pure waste.
  it('skips the commit lookup when a remote ref was resolved and the branch has no PR', async () => {
    mockShell({ ...publishedAs('refs/remotes/origin/feat/y'), prList: [] });

    const result = await getLinkedPullRequest({ branch: 'worktree-feat+x', path: '/repo' });

    expect(ghCalls().some((args) => args[0] === 'api')).toBe(false);
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
      commitPulls: [{ head: { ref: 'someone-elses-branch' }, number: 999 }],
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
      commitPulls: [{ head: { ref: 'someone-elses-branch' }, number: 999 }],
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
    childProcessMocks.execFileAsync.mockRejectedValue(
      Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }),
    );

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
