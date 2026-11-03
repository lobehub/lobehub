import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveUpstream } from '../upstream';

const childProcessMocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: childProcessMocks.execFileAsync,
  });

  return { execFile };
});

const ok = (stdout: string) => ({ stderr: '', stdout });

interface GitFixture {
  /** `for-each-ref refs/heads/<branch>` → `<sha>\t<upstream remote>\t<upstream ref>`. */
  branchRef?: string;
  /**
   * Remote → its `refs/remotes/<remote>/HEAD` target, e.g. `origin` → `origin/canary`.
   * Absent for any repo not created by `git clone`, so nothing may depend on it alone.
   */
  defaultBranch?: Record<string, string>;
  /** Refs this repo pushed to — git writes `update by push` into their reflog. */
  pushedRefs?: string[];
  /** Remote-tracking refs whose tip is the branch's commit. */
  refsAt?: string[];
  remotes?: string[];
  /** Remote refs a local branch already tracks (`for-each-ref --format=%(upstream)`). */
  trackedRefs?: string[];
}

const mockGit = ({
  branchRef = '',
  defaultBranch = {},
  pushedRefs = [],
  refsAt = [],
  remotes = [],
  trackedRefs = [],
}: GitFixture) => {
  childProcessMocks.execFileAsync.mockImplementation(async (_cmd: string, args: string[]) => {
    const [subcommand] = args;

    if (subcommand === 'remote') return ok(remotes.join('\n'));

    if (subcommand === 'reflog') {
      const ref = args[2];
      // A fetched / cloned ref has no reflog at all — git prints nothing.
      return ok(pushedRefs.includes(ref) ? `abc1234 ${ref}@{0}: update by push` : '');
    }

    if (subcommand === 'symbolic-ref') {
      const remote = args[2].replace('refs/remotes/', '').replace('/HEAD', '');
      const target = defaultBranch[remote];
      // `origin/HEAD` unset — git exits non-zero.
      if (!target) throw new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref');
      return ok(target);
    }

    if (subcommand === 'for-each-ref') {
      if (args.includes('--points-at')) return ok(refsAt.join('\n'));
      if (args.includes('--format=%(upstream)')) return ok(trackedRefs.join('\n'));
      return ok(branchRef);
    }

    throw new Error(`unexpected: git ${args.join(' ')}`);
  });
};

describe('resolveUpstream', () => {
  beforeEach(() => {
    childProcessMocks.execFileAsync.mockReset();
  });

  it('uses the configured upstream when it carries the branch’s own name', async () => {
    mockGit({ branchRef: 'sha1\torigin\trefs/remotes/origin/feat/x' });

    expect(await resolveUpstream('/repo', 'feat/x')).toEqual({
      sha: 'sha1',
      upstream: { branch: 'feat/x', remote: 'origin' },
    });
    // The common shape must not pay for the ownership probes.
    expect(childProcessMocks.execFileAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps a slashed remote branch name intact', async () => {
    mockGit({ branchRef: 'sha1\torigin\trefs/remotes/origin/feat/deep/nested' });

    expect((await resolveUpstream('/repo', 'feat/deep/nested')).upstream).toEqual({
      branch: 'feat/deep/nested',
      remote: 'origin',
    });
  });

  // `git checkout -b feat/x origin/canary` auto-sets @{upstream} to the branch it was
  // forked FROM, and leaves it there forever. Taken at face value it would send the PR
  // lookup hunting for a PR whose head is `canary`. Caught end-to-end against real git.
  it('refuses an auto-set fork-base upstream, which is a pull source not a push target', async () => {
    mockGit({
      // @{upstream} = origin/canary, but the branch is feat/x.
      branchRef: 'sha1\torigin\trefs/remotes/origin/canary',
      defaultBranch: { origin: 'origin/canary' },
      remotes: ['origin'],
      trackedRefs: ['refs/remotes/origin/canary'],
    });

    expect(await resolveUpstream('/repo', 'feat/x')).toEqual({ sha: 'sha1' });
  });

  // Same stale fork-base upstream, but the branch HAS since been pushed — under a
  // different name. The pushed ref must win over the fork base.
  it('ignores the fork base and takes the ref the branch was actually pushed to', async () => {
    mockGit({
      branchRef: 'sha1\torigin\trefs/remotes/origin/canary',
      defaultBranch: { origin: 'origin/canary' },
      pushedRefs: ['refs/remotes/origin/feat/renamed'],
      refsAt: ['refs/remotes/origin/feat/renamed'],
      remotes: ['origin'],
      trackedRefs: ['refs/remotes/origin/canary'],
    });

    expect((await resolveUpstream('/repo', 'worktree-x')).upstream).toEqual({
      branch: 'feat/renamed',
      remote: 'origin',
    });
  });

  // `git push -u origin wt-x:feat/y` — a real publication under a different name. Its
  // own ref shows up in the tracked set (the branch tracks it), which must not
  // disqualify it: "tracked" only rules out refs owned by ANOTHER local branch.
  it('trusts a differently-named configured upstream that this repo pushed to', async () => {
    mockGit({
      branchRef: 'sha1\torigin\trefs/remotes/origin/feat/y',
      defaultBranch: { origin: 'origin/canary' },
      pushedRefs: ['refs/remotes/origin/feat/y'],
      refsAt: ['refs/remotes/origin/feat/y'],
      remotes: ['origin'],
      trackedRefs: ['refs/remotes/origin/feat/y'],
    });

    expect((await resolveUpstream('/repo', 'worktree-x')).upstream).toEqual({
      branch: 'feat/y',
      remote: 'origin',
    });
  });

  // The reported bug: `git push origin worktree-x:feat/y` sets no upstream, but it
  // DOES move `refs/remotes/origin/feat/y` onto the branch's commit.
  it('recovers the remote branch from a tracking ref this repo pushed to', async () => {
    mockGit({
      branchRef: 'sha1\t\t',
      defaultBranch: { origin: 'origin/canary' },
      pushedRefs: ['refs/remotes/origin/feat/y'],
      refsAt: ['refs/remotes/origin/feat/y'],
      remotes: ['origin'],
    });

    expect(await resolveUpstream('/repo', 'worktree-feat+x')).toEqual({
      sha: 'sha1',
      upstream: { branch: 'feat/y', remote: 'origin' },
    });
  });

  it('prefers the identically-named remote branch over any other candidate', async () => {
    mockGit({
      branchRef: 'sha1\t\t',
      defaultBranch: { origin: 'origin/canary' },
      refsAt: ['refs/remotes/origin/someone-elses-ref', 'refs/remotes/origin/feat/x'],
      remotes: ['origin'],
    });

    expect((await resolveUpstream('/repo', 'feat/x')).upstream).toEqual({
      branch: 'feat/x',
      remote: 'origin',
    });
  });

  // A branch with no commits of its own still points at the commit it forked from, so
  // the base branch's remote ref sits at that SHA too. Inferring it would bind the
  // topic to canary's PR. Caught end-to-end: the repo had no `origin/HEAD` to guard on.
  it('refuses to infer the fork point, even with no origin/HEAD to recognise it by', async () => {
    mockGit({
      branchRef: 'sha1\t\t',
      // `git init` + `remote add` never writes origin/HEAD — only `git clone` does.
      defaultBranch: {},
      refsAt: ['refs/remotes/origin/canary'],
      remotes: ['origin'],
      // Fetched, not pushed from here → no reflog. And local canary already claims it.
      trackedRefs: ['refs/remotes/origin/canary'],
    });

    expect(await resolveUpstream('/repo', 'worktree-feat+x')).toEqual({ sha: 'sha1' });
  });

  // Same fork point, but this repo DID push canary earlier, so the reflog attests a
  // push. Only "another local branch already tracks it" separates the two.
  it('refuses a ref that another local branch already tracks', async () => {
    mockGit({
      branchRef: 'sha1\t\t',
      pushedRefs: ['refs/remotes/origin/canary'],
      refsAt: ['refs/remotes/origin/canary'],
      remotes: ['origin'],
      trackedRefs: ['refs/remotes/origin/canary'],
    });

    expect((await resolveUpstream('/repo', 'worktree-feat+x')).upstream).toBeUndefined();
  });

  // Forked from a ref that arrived by fetch/clone: it has no push reflog, which is
  // what proves the commit got there by someone else's push, not ours.
  it('refuses a ref this repo never pushed to', async () => {
    mockGit({
      branchRef: 'sha1\t\t',
      refsAt: ['refs/remotes/origin/colleagues-branch'],
      remotes: ['origin'],
    });

    expect((await resolveUpstream('/repo', 'worktree-feat+x')).upstream).toBeUndefined();
  });

  it('still refuses a remote default branch it happens to have pushed', async () => {
    mockGit({
      branchRef: 'sha1\t\t',
      defaultBranch: { origin: 'origin/canary' },
      pushedRefs: ['refs/remotes/origin/canary'],
      refsAt: ['refs/remotes/origin/canary'],
      remotes: ['origin'],
    });

    expect((await resolveUpstream('/repo', 'worktree-feat+x')).upstream).toBeUndefined();
  });

  it('refuses to guess between several differently-named candidates', async () => {
    mockGit({
      branchRef: 'sha1\t\t',
      defaultBranch: { origin: 'origin/canary' },
      pushedRefs: ['refs/remotes/origin/feat/a', 'refs/remotes/origin/feat/b'],
      refsAt: ['refs/remotes/origin/feat/a', 'refs/remotes/origin/feat/b'],
      remotes: ['origin'],
    });

    expect((await resolveUpstream('/repo', 'worktree-feat+x')).upstream).toBeUndefined();
  });

  it('ignores the symbolic origin/HEAD pointer as a candidate', async () => {
    mockGit({
      branchRef: 'sha1\t\t',
      pushedRefs: ['refs/remotes/origin/HEAD'],
      refsAt: ['refs/remotes/origin/HEAD'],
      remotes: ['origin'],
    });

    expect((await resolveUpstream('/repo', 'worktree-feat+x')).upstream).toBeUndefined();
  });

  // The whole point of the field: an unpushed branch has NO remote ref, and the local
  // name is not a stand-in for one.
  it('never falls back to the local branch name for an unpushed branch', async () => {
    mockGit({ branchRef: 'sha1\t\t', remotes: ['origin'] });

    expect(await resolveUpstream('/repo', 'worktree-feat+x')).toEqual({ sha: 'sha1' });
  });

  it('yields nothing for a branch that does not exist locally', async () => {
    mockGit({ branchRef: '' });

    expect(await resolveUpstream('/repo', 'gone')).toEqual({});
  });

  it('degrades silently in a repo with no remotes', async () => {
    mockGit({ branchRef: 'sha1\t\t', remotes: [] });

    expect(await resolveUpstream('/repo', 'feat/x')).toEqual({ sha: 'sha1' });
  });

  it('degrades silently when git itself fails', async () => {
    childProcessMocks.execFileAsync.mockRejectedValue(new Error('not a git repository'));

    expect(await resolveUpstream('/nowhere', 'feat/x')).toEqual({});
  });
});
