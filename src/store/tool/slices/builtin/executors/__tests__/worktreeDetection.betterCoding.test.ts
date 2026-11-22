import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordGitCommandEffects } from '../worktreeDetection';

const chatMocks = vi.hoisted(() => ({
  topics: {} as Record<string, { metadata?: Record<string, any> }>,
  updateTopicMetadata: vi.fn(),
}));
const labMocks = vi.hoisted(() => ({ betterCoding: true }));
const linkMocks = vi.hoisted(() => ({ linkPushedPullRequests: vi.fn(async () => []) }));
const gsMocks = vi.hoisted(() => ({ revalidateGitStatus: vi.fn() }));

vi.mock('@/store/device/gitStatus/store', () => ({ getGitStatusStoreState: () => gsMocks }));
vi.mock('@/store/chat/store', () => ({ getChatStoreState: () => chatMocks }));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (state: typeof chatMocks) => state.topics[id],
  },
}));
vi.mock('@/services/git', () => ({ gitService: { listGitWorktrees: vi.fn() } }));
vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: 'device-1' } }),
}));
vi.mock('@/store/user', () => ({ getUserStoreState: () => ({}) }));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableBetterCodingExperience: () => labMocks.betterCoding },
}));
vi.mock('../pushedPullRequests', () => linkMocks);

const topic = (git: Record<string, unknown> = { branch: 'feat/x' }) => ({
  metadata: { workingDirectoryConfig: { git, path: '/repo', repoType: 'github' } },
});

const PUSH = {
  command: 'git push',
  resultContent: [
    'To github.com:lobehub/lobehub.git',
    '   031bf96..f6b1c2a  feat/x -> feat/x',
  ].join('\n'),
};

describe('recordGitCommandEffects — Better Coding Experience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    labMocks.betterCoding = true;
    chatMocks.topics = { t1: topic() };
  });

  it('records the push of a push-and-create chain but leaves the PR to the server', async () => {
    await recordGitCommandEffects({
      command: 'git push -u origin HEAD && gh pr create --title "Fix"',
      resultContent: [
        'To github.com:lobehub/lobehub.git',
        ' * [new branch]      HEAD -> feat/x',
        'https://github.com/lobehub/lobehub/pull/456',
      ].join('\n'),
      toolCallId: 'call-1',
      topicId: 't1',
    });

    const git = chatMocks.updateTopicMetadata.mock.calls[0][1].workingDirectoryConfig.git;
    expect(git.upstream).toEqual({ branch: 'feat/x', remote: 'origin' });
    expect(git).not.toHaveProperty('github');
  });

  it('still records the upstream of a push, then links its PR through the server', async () => {
    await recordGitCommandEffects({ ...PUSH, toolCallId: 'call-push', topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { branch: 'feat/x', upstream: { branch: 'feat/x', remote: 'origin' } },
        path: '/repo',
        repoType: 'github',
      },
    });
    expect(linkMocks.linkPushedPullRequests).toHaveBeenCalledWith({
      branch: 'feat/x',
      deviceId: undefined,
      path: '/repo',
      toolCallId: 'call-push',
      topicId: 't1',
    });
  });

  it('looks up on the bound remote device, in the topic worktree', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          boundDeviceId: 'device-remote',
          workingDirectoryConfig: {
            git: { activeWorktree: '/repo-wt', branch: 'feat/x', isWorktree: true },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordGitCommandEffects({ ...PUSH, toolCallId: 'call-push', topicId: 't1' });

    expect(linkMocks.linkPushedPullRequests).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-remote', path: '/repo-wt' }),
    );
  });

  it('does not link without the call id, or with the lab off', async () => {
    await recordGitCommandEffects({ ...PUSH, topicId: 't1' });
    labMocks.betterCoding = false;
    await recordGitCommandEffects({ ...PUSH, toolCallId: 'call-push', topicId: 't1' });

    expect(linkMocks.linkPushedPullRequests).not.toHaveBeenCalled();
  });

  it('keeps binding gh pr create while the lab is off', async () => {
    labMocks.betterCoding = false;

    await recordGitCommandEffects({
      command: 'gh pr create --title "Fix"',
      resultContent: 'https://github.com/lobehub/lobehub/pull/456',
      topicId: 't1',
    });

    expect(
      chatMocks.updateTopicMetadata.mock.calls[0][1].workingDirectoryConfig.git.github.pullRequest
        .number,
    ).toBe(456);
  });

  it('links a push whose result repeats the ref table under Stdout and Stderr', async () => {
    const table = ['To github.com:lobehub/lobehub.git', '   031bf96..f6b1c2a  feat/x -> feat/x'];
    await recordGitCommandEffects({
      command: 'git push',
      resultContent: ['Stdout:', ...table, 'Stderr:', ...table].join('\n'),
      toolCallId: 'call-push',
      topicId: 't1',
    });

    expect(linkMocks.linkPushedPullRequests).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'feat/x', toolCallId: 'call-push' }),
    );
  });

  it("records a branch the agent created as the topic's own", async () => {
    await recordGitCommandEffects({
      command: 'git switch -c feat/new',
      resultContent: "Switched to a new branch 'feat/new'",
      toolCallId: 'call-1',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata.mock.calls[0][1].workingDirectoryConfig.git).toMatchObject(
      { branch: 'feat/new', ownBranch: 'feat/new' },
    );
  });

  it('does not own a branch it only switched to', async () => {
    await recordGitCommandEffects({
      command: 'git switch main',
      resultContent: "Switched to branch 'main'",
      toolCallId: 'call-1',
      topicId: 't1',
    });

    expect(
      chatMocks.updateTopicMetadata.mock.calls[0][1].workingDirectoryConfig.git,
    ).not.toHaveProperty('ownBranch');
  });

  it('owns a branch created by a quiet switch that printed nothing', async () => {
    await recordGitCommandEffects({
      command: 'git switch -q -c feat/quiet',
      resultContent: '',
      toolCallId: 'call-1',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata.mock.calls[0][1].workingDirectoryConfig.git).toMatchObject(
      { branch: 'feat/quiet', ownBranch: 'feat/quiet' },
    );
  });

  it('owns a branch only when the flag guarantees creation, not a create-or-reset', async () => {
    for (const command of [
      'git switch -q -C feat/x feat/x',
      'git checkout -q -B feat/x',
      'git worktree add -B feat/x /tmp/wt',
    ]) {
      chatMocks.updateTopicMetadata.mockClear();
      chatMocks.topics = { t1: topic() };
      await recordGitCommandEffects({ command, resultContent: '', toolCallId: 'c', topicId: 't1' });
      const git = chatMocks.updateTopicMetadata.mock.calls[0]?.[1].workingDirectoryConfig.git;
      expect(git?.ownBranch).toBeUndefined();
    }

    chatMocks.updateTopicMetadata.mockClear();
    await recordGitCommandEffects({
      command: 'git checkout -q -b feat/new',
      resultContent: '',
      toolCallId: 'c',
      topicId: 't1',
    });
    expect(
      chatMocks.updateTopicMetadata.mock.calls[0][1].workingDirectoryConfig.git.ownBranch,
    ).toBe('feat/new');
  });

  it('does not own a branch whose creation a fallback may have rescued', async () => {
    await recordGitCommandEffects({
      command: 'git switch -q -c feat/x || git switch -q feat/x',
      resultContent: '',
      toolCallId: 'c',
      topicId: 't1',
    });

    const git = chatMocks.updateTopicMetadata.mock.calls[0]?.[1].workingDirectoryConfig.git;
    expect(git?.ownBranch).toBeUndefined();
  });
});
