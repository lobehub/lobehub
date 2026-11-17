import { DEVICE_GIT_OUTDATED, getWorktreeModeKey } from '@lobechat/types';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';
import { DeviceGitOutdatedError, gitService } from '@/services/git';
import { useGitStatusStore } from '@/store/device/gitStatus/store';
import { useUserStore } from '@/store/user';

import {
  draftBranchKey,
  type DraftGitTarget,
  getDraftBranch,
  registerDraftGitTarget,
  setDraftBranch,
  useDraftGitStore,
} from './draftGitStore';
import {
  type DraftGitSendPrompts,
  needsSendTimeGit,
  prepareDraftGitSend,
  snapshotDraftGit,
} from './prepareSend';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/services/git', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    gitService: {
      addGitWorktree: vi.fn(),
      checkoutGitBranch: vi.fn(),
      getGitAheadBehind: vi.fn(),
      getGitBranch: vi.fn(),
      getGitWorkingTreeStatus: vi.fn(),
      listGitBranches: vi.fn(),
      listGitWorktrees: vi.fn(),
    },
  };
});

// The server-signed creation receipt for a new worktree.
const issueWorktreeReceipt = vi.hoisted(() =>
  vi.fn(async () => ({ nonce: 'nonce-1', token: 'signed-token-0123456789' })),
);
vi.mock('@/services/ownedWorktree', () => ({ issueWorktreeReceipt }));

vi.mock('@/services/device', () => ({
  deviceService: { countRunningTopicsInDirectory: vi.fn() },
}));

const t = ((key: string) => key) as unknown as TFunction<'device'>;

const target: DraftGitTarget = {
  agentId: 'agent-1',
  deviceId: 'dev-1',
  isGithub: true,
  keyDeviceId: 'dev-1',
  path: '/code/lobehub',
  sourcePath: '/code/lobehub',
};
const context = { agentId: 'agent-1', topicId: null };

const prompts = (): DraftGitSendPrompts & { [K in keyof DraftGitSendPrompts]: any } => ({
  askBranchName: vi.fn(async ({ defaultName }) => defaultName),
  confirmSwitchRisks: vi.fn(async () => true),
  notifyError: vi.fn(),
  showProgress: vi.fn(() => () => {}),
});

const setLab = (on: boolean) =>
  useUserStore.setState({
    preference: {
      ...useUserStore.getState().preference,
      lab: { enableBetterCodingExperience: on },
    },
  } as any);

const setWorktreeMode = (on: boolean) =>
  useUserStore.setState({
    preference: {
      ...useUserStore.getState().preference,
      worktreeModeDirs: on ? [getWorktreeModeKey('dev-1', target.path)] : [],
    },
  } as any);

const pick = (branch: string) => setDraftBranch(draftBranchKey(target), branch);

beforeEach(() => {
  vi.clearAllMocks();
  useDraftGitStore.setState({ selections: {}, targets: {} });
  useGitStatusStore.setState({ gitAheadBehindMap: {} });
  registerDraftGitTarget(target);
  setLab(true);
  setWorktreeMode(false);
  vi.mocked(gitService.getGitBranch).mockResolvedValue({ branch: 'main' });
  vi.mocked(gitService.listGitWorktrees).mockResolvedValue([
    { current: true, path: '/code/lobehub', branch: 'main' },
  ]);
  vi.mocked(gitService.listGitBranches).mockResolvedValue([
    { current: true, name: 'main' },
    { current: false, name: 'feat' },
  ]);
  vi.mocked(gitService.getGitWorkingTreeStatus).mockResolvedValue({
    added: 0,
    clean: true,
    deleted: 0,
    modified: 0,
    total: 0,
  });
  vi.mocked(gitService.checkoutGitBranch).mockResolvedValue({ success: true });
  vi.mocked(gitService.getGitAheadBehind).mockImplementation(async ({ branch }) => ({
    ahead: 0,
    behind: 0,
    branch,
    hasUpstream: true,
  }));
  vi.mocked(deviceService.countRunningTopicsInDirectory).mockResolvedValue(0);
});

describe('prepareDraftGitSend — nothing to do', () => {
  it('passes without touching git when the lab is off', async () => {
    setLab(false);
    pick('feat');
    expect(await prepareDraftGitSend(context, { prompts: prompts(), t })).toEqual({ ok: true });
    expect(gitService.getGitBranch).not.toHaveBeenCalled();
  });

  it('passes for an existing topic', async () => {
    pick('feat');
    const result = await prepareDraftGitSend(
      { agentId: 'agent-1', topicId: 'tpc_1' },
      { prompts: prompts(), t },
    );
    expect(result).toEqual({ ok: true });
    expect(gitService.checkoutGitBranch).not.toHaveBeenCalled();
  });

  it('does nothing when the picked branch is the current one', async () => {
    pick('main');
    expect(await prepareDraftGitSend(context, { prompts: prompts(), t })).toEqual({ ok: true });
    expect(gitService.checkoutGitBranch).not.toHaveBeenCalled();
  });
});

describe('prepareDraftGitSend — direct @Agent route', () => {
  const mentionOf = (id: string) => ({
    root: {
      children: [
        {
          children: [
            { label: 'B', metadata: { id, type: 'agent' }, type: 'mention' },
            { text: ' do it', type: 'text' },
          ],
          type: 'paragraph',
        },
      ],
      type: 'root',
    },
  });

  it('leaves git alone when the message runs another agent', async () => {
    pick('feat');
    setWorktreeMode(true);
    const result = await prepareDraftGitSend(context, {
      editorData: mentionOf('agent-2'),
      prompts: prompts(),
      t,
    });

    expect(result).toEqual({ ok: true });
    expect(gitService.addGitWorktree).not.toHaveBeenCalled();
    expect(gitService.checkoutGitBranch).not.toHaveBeenCalled();
  });
});

describe('prepareDraftGitSend — snapshot taken at send time', () => {
  it('acts on the snapshot even after the composer dropped the directory', async () => {
    pick('feat');
    const snapshot = snapshotDraftGit(context)!;
    // The user moved to another topic: the bar unregistered, the pick is gone.
    useDraftGitStore.setState({ selections: {}, targets: {} });

    expect(await prepareDraftGitSend(context, { prompts: prompts(), snapshot, t })).toEqual({
      acted: true,
      ok: true,
    });
    expect(gitService.checkoutGitBranch).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'feat', path: '/code/lobehub' }),
    );
  });
});

describe('needsSendTimeGit', () => {
  it('is set only by a branch pick or the worktree switch', () => {
    expect(needsSendTimeGit(snapshotDraftGit(context))).toBe(false);
    pick('feat');
    expect(needsSendTimeGit(snapshotDraftGit(context))).toBe(true);
    setDraftBranch(draftBranchKey(target), undefined);
    setWorktreeMode(true);
    expect(needsSendTimeGit(snapshotDraftGit(context))).toBe(true);
    expect(needsSendTimeGit(undefined)).toBe(false);
  });
});

describe('prepareDraftGitSend — switch in place', () => {
  it('checks out the picked branch and clears the pick', async () => {
    pick('feat');
    const result = await prepareDraftGitSend(context, { prompts: prompts(), t });

    expect(result).toEqual({ acted: true, ok: true });
    expect(gitService.checkoutGitBranch).toHaveBeenCalledWith({
      branch: 'feat',
      deviceId: 'dev-1',
      path: '/code/lobehub',
    });
    expect(getDraftBranch(draftBranchKey(target))).toBeUndefined();
  });

  it('warns about uncommitted changes and running topics in one confirmation', async () => {
    pick('feat');
    vi.mocked(gitService.getGitWorkingTreeStatus).mockResolvedValue({
      added: 1,
      clean: false,
      deleted: 0,
      modified: 2,
      total: 3,
    });
    vi.mocked(deviceService.countRunningTopicsInDirectory).mockResolvedValue(2);
    const p = prompts();

    await prepareDraftGitSend(context, { prompts: p, t });

    expect(deviceService.countRunningTopicsInDirectory).toHaveBeenCalledWith('dev-1', target.path);
    expect(p.confirmSwitchRisks).toHaveBeenCalledWith({
      branch: 'feat',
      running: 2,
      uncommitted: 3,
    });
    expect(gitService.checkoutGitBranch).toHaveBeenCalled();
  });

  it('keeps the draft and does not switch when the warning is declined', async () => {
    pick('feat');
    vi.mocked(deviceService.countRunningTopicsInDirectory).mockResolvedValue(1);
    const p = prompts();
    p.confirmSwitchRisks.mockResolvedValue(false);

    expect(await prepareDraftGitSend(context, { prompts: p, t })).toEqual({ ok: false });
    expect(gitService.checkoutGitBranch).not.toHaveBeenCalled();
    expect(getDraftBranch(draftBranchKey(target))).toBe('feat');
  });

  it('does not ask when the directory is clean and nothing else runs there', async () => {
    pick('feat');
    const p = prompts();
    await prepareDraftGitSend(context, { prompts: p, t });
    expect(p.confirmSwitchRisks).not.toHaveBeenCalled();
  });

  it('still switches when the running-topic count cannot be read', async () => {
    pick('feat');
    vi.mocked(deviceService.countRunningTopicsInDirectory).mockRejectedValue(new Error('down'));
    expect(await prepareDraftGitSend(context, { prompts: prompts(), t })).toEqual({
      acted: true,
      ok: true,
    });
  });

  it('reports a refused checkout and keeps the draft', async () => {
    pick('feat');
    vi.mocked(gitService.checkoutGitBranch).mockResolvedValue({
      error: 'error: Your local changes would be overwritten by checkout',
      success: false,
    });
    const p = prompts();

    expect(await prepareDraftGitSend(context, { prompts: p, t })).toEqual({ ok: false });
    expect(p.notifyError).toHaveBeenCalledWith({
      description: 'error: Your local changes would be overwritten by checkout',
      title: 'workingDirectory.switchFailed',
    });
    expect(getDraftBranch(draftBranchKey(target))).toBe('feat');
  });

  it('cuts a named branch from a branch another worktree holds', async () => {
    pick('feat');
    vi.mocked(gitService.listGitWorktrees).mockResolvedValue([
      { branch: 'main', current: true, path: '/code/lobehub' },
      { branch: 'feat', current: false, path: '/wt/feat' },
    ]);
    vi.mocked(gitService.checkoutGitBranch).mockResolvedValue({
      startPoint: 'feat',
      success: true,
    });
    const p = prompts();
    p.askBranchName.mockResolvedValue('lobehub/mine');

    expect(await prepareDraftGitSend(context, { prompts: p, t })).toEqual({
      acted: true,
      ok: true,
    });
    expect(p.askBranchName).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'feat', holder: 'feat' }),
    );
    expect(p.askBranchName.mock.calls[0][0].defaultName).toMatch(/\//);
    expect(gitService.checkoutGitBranch).toHaveBeenCalledWith({
      branch: 'lobehub/mine',
      create: true,
      deviceId: 'dev-1',
      path: '/code/lobehub',
      startPoint: 'feat',
    });
  });

  it('stops when the branch-name prompt is cancelled', async () => {
    pick('feat');
    vi.mocked(gitService.listGitWorktrees).mockResolvedValue([
      { branch: 'feat', current: false, path: '/wt/feat' },
    ]);
    const p = prompts();
    p.askBranchName.mockResolvedValue(undefined);

    expect(await prepareDraftGitSend(context, { prompts: p, t })).toEqual({ ok: false });
    expect(gitService.checkoutGitBranch).not.toHaveBeenCalled();
  });

  it('refuses before mutating on a device too old for a start point', async () => {
    pick('feat');
    vi.mocked(gitService.listGitWorktrees).mockResolvedValue([
      { branch: 'feat', current: false, path: '/wt/feat' },
    ]);
    vi.mocked(gitService.getGitAheadBehind).mockRejectedValue(
      new DeviceGitOutdatedError('"branch"'),
    );
    const p = prompts();

    expect(await prepareDraftGitSend(context, { prompts: p, t })).toEqual({ ok: false });
    expect(gitService.checkoutGitBranch).not.toHaveBeenCalled();
    expect(p.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'workingDirectory.deviceOutdated' }),
    );
  });
});

describe('prepareDraftGitSend — new worktree', () => {
  beforeEach(() => {
    setWorktreeMode(true);
    vi.mocked(gitService.addGitWorktree).mockImplementation(async ({ branch, startPoint }) => ({
      ...(startPoint ? { startPoint } : {}),
      success: true,
      worktreePath: `/Users/me/.lobehub/worktrees/lobehub-0000beef/${branch.split('/').at(-1)}`,
    }));
  });

  it('forks the picked branch into a new worktree that becomes the topic directory', async () => {
    pick('feat');
    const p = prompts();
    const result = await prepareDraftGitSend(context, { prompts: p, t });

    const call = vi.mocked(gitService.addGitWorktree).mock.calls[0][0];
    expect(call).toMatchObject({
      deviceId: 'dev-1',
      path: '/code/lobehub',
      sourcePath: '/code/lobehub',
      startPoint: 'feat',
      stripBranchPrefix: true,
    });
    expect(call.branch).toMatch(/^[a-z]+\/\d{12}-[a-z]+-[a-z]+$/);
    expect(result).toEqual({
      acted: true,
      newTopicWorkingDirectory: {
        git: {
          activeWorktree: expect.stringContaining('/.lobehub/worktrees/'),
          autoCreated: true,
          autoCreatedAt: expect.any(String),
          branch: call.branch,
          isWorktree: true,
          // The send created the branch: the run end may look its PR up.
          ownBranch: call.branch,
        },
        path: '/code/lobehub',
        repoType: 'github',
        sessionPath: expect.stringContaining('/.lobehub/worktrees/'),
      },
      ok: true,
    });
    // Nothing touches the source directory, so nothing is asked.
    expect(gitService.checkoutGitBranch).not.toHaveBeenCalled();
    expect(p.confirmSwitchRisks).not.toHaveBeenCalled();
    expect(deviceService.countRunningTopicsInDirectory).not.toHaveBeenCalled();
  });

  it('records the server-signed receipt only once the device echoes it back', async () => {
    vi.mocked(gitService.addGitWorktree).mockImplementation(async ({ branch, ownerToken }) => ({
      ownerToken,
      success: true,
      worktreePath: `/Users/me/.lobehub/worktrees/lobehub-0000beef/${branch.split('/').at(-1)}`,
    }));
    const recorded = await prepareDraftGitSend(context, { prompts: prompts(), t });
    expect(vi.mocked(gitService.addGitWorktree).mock.calls[0][0].ownerToken).toBe(
      'signed-token-0123456789',
    );
    expect(recorded.ok && recorded.newTopicWorkingDirectory?.git).toMatchObject({
      ownerNonce: 'nonce-1',
      ownerToken: 'signed-token-0123456789',
    });

    // A device too old to write it echoes nothing: no receipt is claimed.
    vi.mocked(gitService.addGitWorktree).mockImplementation(async ({ branch }) => ({
      success: true,
      worktreePath: `/Users/me/.lobehub/worktrees/lobehub-0000beef/${branch.split('/').at(-1)}`,
    }));
    const older = await prepareDraftGitSend(context, { prompts: prompts(), t });
    expect(older.ok && older.newTopicWorkingDirectory?.git?.ownerToken).toBeUndefined();

    // No receipt from the server: the worktree is still created, without one.
    issueWorktreeReceipt.mockResolvedValueOnce(undefined as any);
    vi.mocked(gitService.addGitWorktree).mockClear();
    const unsigned = await prepareDraftGitSend(context, { prompts: prompts(), t });
    expect(vi.mocked(gitService.addGitWorktree).mock.calls[0][0].ownerToken).toBeUndefined();
    expect(unsigned.ok).toBe(true);
  });

  it('forks from HEAD without a start point when nothing else was picked', async () => {
    await prepareDraftGitSend(context, { prompts: prompts(), t });

    expect(vi.mocked(gitService.addGitWorktree).mock.calls[0][0].startPoint).toBeUndefined();
    expect(gitService.getGitAheadBehind).not.toHaveBeenCalled();
  });

  it('reports a failed worktree and sends nothing', async () => {
    pick('feat');
    vi.mocked(gitService.addGitWorktree).mockResolvedValue({
      error: 'fatal: a branch named x already exists',
      success: false,
    });
    const p = prompts();

    expect(await prepareDraftGitSend(context, { prompts: p, t })).toEqual({ ok: false });
    expect(p.notifyError).toHaveBeenCalledWith({
      description: 'fatal: a branch named x already exists',
      title: 'workingDirectory.worktreeCreateFailed',
    });
    expect(getDraftBranch(draftBranchKey(target))).toBe('feat');
  });

  it('says to update the device when it ignored the start point', async () => {
    pick('feat');
    vi.mocked(gitService.addGitWorktree).mockResolvedValue({
      error: 'outdated',
      reason: DEVICE_GIT_OUTDATED,
      success: false,
    });
    const p = prompts();

    expect(await prepareDraftGitSend(context, { prompts: p, t })).toEqual({ ok: false });
    expect(p.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'workingDirectory.deviceOutdated' }),
    );
  });
});
