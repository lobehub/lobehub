// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ParentWorkspaceError, prepareParentWorkspace } from './parentWorkspace';

const mocks = vi.hoisted(() => ({
  countLiveTopicsUsingWorktree: vi.fn(),
  createFirstSendWorktree: vi.fn(),
  deleteGitBranch: vi.fn(),
  findById: vi.fn(),
  removeGitWorktree: vi.fn(),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return {
      countLiveTopicsUsingWorktree: mocks.countLiveTopicsUsingWorktree,
      findById: mocks.findById,
    };
  }),
}));
vi.mock('./createFirstSendWorktree', () => ({
  createFirstSendWorktree: mocks.createFirstSendWorktree,
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    deleteGitBranch: mocks.deleteGitBranch,
    removeGitWorktree: mocks.removeGitWorktree,
  },
}));
vi.mock('@/server/services/worktreeCleanup/receipt', () => ({
  issueWorktreeReceipt: () => ({ nonce: 'nonce-1', token: 'token-1' }),
}));
vi.mock('../foregroundIntervention', () => ({
  resolveForegroundInterventionConfig: vi.fn(async () => ({ approvalMode: 'auto-run' })),
}));

const scope = { db: {} as any, userId: 'user-1' };

const parent = {
  agentId: 'agt_lobe',
  id: 'tpc_parent',
  metadata: {
    boundDeviceId: 'dev_mac',
    workingDirectory: '/repo/.worktrees/quiet-hill',
    workingDirectoryConfig: {
      git: {
        activeWorktree: '/repo/.worktrees/quiet-hill',
        autoCreated: true,
        autoCreatedAt: '2026-11-17T00:00:00.000Z',
        branch: 'lobehub/quiet-hill',
        isWorktree: true,
        ownBranch: 'lobehub/quiet-hill',
        ownerNonce: 'nonce-parent',
        ownerToken: 'token-parent',
      },
      path: '/repo',
      repoType: 'github',
    },
  },
};

const base = { agentId: 'agt_lobe', openedByTopicId: 'tpc_parent', prompt: 'x' } as any;

describe('prepareParentWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValue(parent);
    mocks.countLiveTopicsUsingWorktree.mockResolvedValue(0);
    mocks.removeGitWorktree.mockResolvedValue({ success: true });
    mocks.createFirstSendWorktree.mockResolvedValue({
      git: {
        activeWorktree: '/home/.lobehub/worktrees/repo/brave-river',
        autoCreated: true,
        branch: 'lobehub/brave-river',
        ownBranch: 'lobehub/brave-river',
        ownerNonce: 'nonce-1',
        ownerToken: 'token-1',
      },
      path: '/repo',
    });
  });

  it('passes runs that name no workspace, or continue a topic, through unchanged', async () => {
    expect((await prepareParentWorkspace(scope, base)).params).toBe(base);

    const continuing = { ...base, appContext: { topicId: 'tpc_x' }, parentWorkspace: 'inherit' };
    expect((await prepareParentWorkspace(scope, continuing)).params).toBe(continuing);
  });

  it("shares the parent's directory on its device, without its claims on the worktree", async () => {
    const { params, rollback } = await prepareParentWorkspace(scope, {
      ...base,
      parentWorkspace: 'inherit',
    });

    expect(params.deviceId).toBe('dev_mac');
    // A sub-topic asks for approvals like the user's own conversations.
    expect(params.userInterventionConfig).toEqual({ approvalMode: 'auto-run' });
    const initial = params.appContext?.initialTopicMetadata as any;
    expect(initial.workingDirectory).toBe('/repo/.worktrees/quiet-hill');
    const git = initial.workingDirectoryConfig.git;
    expect(git.branch).toBe('lobehub/quiet-hill');
    for (const claim of ['autoCreated', 'autoCreatedAt', 'ownBranch', 'ownerNonce', 'ownerToken'])
      expect(git[claim]).toBeUndefined();
    expect(rollback).toBeUndefined();
  });

  it("never hands the parent's device to a run opened by one that may not use devices", async () => {
    // e.g. `lh topic send --new` from the sandbox of an external bot sender's run.
    const denied = { ...base, delegatedDeviceAccessDenied: true };

    const inherited = await prepareParentWorkspace(scope, {
      ...denied,
      parentWorkspace: 'inherit',
    });
    expect(inherited.params.deviceId).toBeUndefined();
    expect(inherited.params.appContext?.initialTopicMetadata).toBeUndefined();

    const none = await prepareParentWorkspace(scope, {
      ...denied,
      deviceId: 'dev_mac',
      parentWorkspace: 'none',
    });
    expect(none.params.deviceId).toBeUndefined();

    await expect(
      prepareParentWorkspace(scope, { ...denied, parentWorkspace: 'new-worktree' }),
    ).rejects.toBeInstanceOf(ParentWorkspaceError);
    expect(mocks.createFirstSendWorktree).not.toHaveBeenCalled();

    // A cloud-sandbox placement is not a device: it still carries over.
    mocks.findById.mockResolvedValue({
      id: 'tpc_parent',
      metadata: { boundDeviceId: 'dev_mac', sandboxInstanceId: 'inst_web' },
    });
    const sandboxed = await prepareParentWorkspace(scope, {
      ...denied,
      parentWorkspace: 'inherit',
    });
    expect(sandboxed.params.deviceId).toBeUndefined();
    expect(sandboxed.params.appContext?.initialTopicMetadata).toEqual({
      sandboxInstanceId: 'inst_web',
    });
  });

  it("carries a cloud-sandbox parent's placement", async () => {
    mocks.findById.mockResolvedValue({
      id: 'tpc_parent',
      metadata: { sandboxDrive: 'personal', sandboxInstanceId: 'inst_web' },
    });

    const { params } = await prepareParentWorkspace(scope, { ...base, parentWorkspace: 'inherit' });

    expect(params.appContext?.initialTopicMetadata).toEqual({
      sandboxDrive: 'personal',
      sandboxInstanceId: 'inst_web',
    });
  });

  it('keeps a named device and sets no directory with "none"', async () => {
    const { params } = await prepareParentWorkspace(scope, {
      ...base,
      deviceId: 'dev_linux',
      parentWorkspace: 'none',
    });

    expect(params.deviceId).toBe('dev_linux');
    expect(params.appContext).toBeUndefined();
  });

  it("cuts a claimed worktree from the parent's repository, pinned to its device", async () => {
    const { params, rollback } = await prepareParentWorkspace(scope, {
      ...base,
      parentWorkspace: 'new-worktree',
      parentWorkspaceBaseBranch: 'canary',
    });

    expect(mocks.createFirstSendWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: 'canary',
        branch: expect.stringMatching(/^lobehub\//),
        deviceId: 'dev_mac',
        ownerNonce: 'nonce-1',
        ownerToken: 'token-1',
        path: '/repo/.worktrees/quiet-hill',
        repoType: 'github',
        sourcePath: '/repo',
      }),
      { userId: 'user-1', workspaceId: undefined },
    );
    expect(params).toMatchObject({ deviceId: 'dev_mac', requireDevice: true });
    expect((params.appContext?.initialTopicMetadata as any).workingDirectory).toBe(
      '/home/.lobehub/worktrees/repo/brave-river',
    );
    expect(rollback).toEqual(expect.any(Function));
  });

  it('refuses a new worktree without a repository on a device', async () => {
    mocks.findById.mockResolvedValue({ id: 'tpc_parent', metadata: {} });

    await expect(
      prepareParentWorkspace(scope, { ...base, parentWorkspace: 'new-worktree' }),
    ).rejects.toBeInstanceOf(ParentWorkspaceError);
    expect(mocks.createFirstSendWorktree).not.toHaveBeenCalled();
  });

  it('takes the new worktree back unless a topic already points at it', async () => {
    const { rollback } = await prepareParentWorkspace(scope, {
      ...base,
      parentWorkspace: 'new-worktree',
    });

    await rollback!();
    expect(mocks.removeGitWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: '/home/.lobehub/worktrees/repo/brave-river' }),
    );
    expect(mocks.deleteGitBranch).toHaveBeenCalledWith(
      expect.objectContaining({ branch: expect.stringMatching(/^lobehub\//) }),
    );

    vi.clearAllMocks();
    mocks.countLiveTopicsUsingWorktree.mockResolvedValue(1);
    await rollback!();
    expect(mocks.removeGitWorktree).not.toHaveBeenCalled();
  });
});
