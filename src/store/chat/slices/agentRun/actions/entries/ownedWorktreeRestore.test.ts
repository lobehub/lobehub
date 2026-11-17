import type { ChatTopicMetadata } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatTopic } from '@/types/topic';

import { ensureOwnedWorktreeForRun } from './ownedWorktreeRestore';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  isDesktop: true,
  isLocal: vi.fn(),
  restore: vi.fn(),
  statPath: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get isDesktop() {
    return mocks.isDesktop;
  },
}));
vi.mock('@lobehub/ui', () => ({
  toast: { error: mocks.toastError, warning: mocks.toastWarning },
}));
vi.mock('@/services/ownedWorktree', () => ({
  isLocalOwnedWorktree: mocks.isLocal,
  restoreOwnedWorktree: mocks.restore,
}));
vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ workspace: { statPath: mocks.statPath } }),
}));
vi.mock('@/store/chat', () => ({
  getChatStoreState: () => ({ internal_dispatchTopic: mocks.dispatch }),
}));

const WT = '/Users/me/.lobehub/worktrees/repo-1a2b3c4d/quiet-hill';

const topic = (metadata: ChatTopicMetadata): ChatTopic =>
  ({ createdAt: 0, favorite: false, id: 'tpc_1', metadata, title: 't', updatedAt: 0 }) as ChatTopic;

/** A topic born in a worktree the app created, cleaned up while archived. */
const restoredTopic = () =>
  topic({
    boundDeviceId: 'dev-1',
    ownedWorktrees: [
      {
        branch: 'lobehub/quiet-hill',
        cleanup: { at: 'x', state: 'removed', trigger: 'archived' },
        createdAt: 'y',
        deviceId: 'dev-1',
        path: WT,
        sourcePath: '/code/repo',
      },
    ],
    workingDirectory: WT,
    workingDirectoryConfig: {
      git: { activeWorktree: WT, branch: 'lobehub/quiet-hill' },
      path: '/code/repo',
      repoType: 'github',
      sessionPath: WT,
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isDesktop = true;
});

describe('ensureOwnedWorktreeForRun', () => {
  it('leaves a topic without an app-created worktree alone', async () => {
    const plain = topic({ workingDirectory: '/code/repo' });
    await expect(ensureOwnedWorktreeForRun(plain)).resolves.toBe(plain);
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('does nothing when the worktree is still on this desktop', async () => {
    mocks.isLocal.mockResolvedValue(true);
    mocks.statPath.mockResolvedValue({ exists: true, isDirectory: true });
    const subject = restoredTopic();
    await expect(ensureOwnedWorktreeForRun(subject)).resolves.toBe(subject);
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('rebuilds a removed worktree before the turn and keeps the session path', async () => {
    mocks.isLocal.mockResolvedValue(true);
    mocks.statPath.mockResolvedValue({ exists: false, isDirectory: false });
    mocks.restore.mockResolvedValue({ outcome: 'restored' });
    const subject = restoredTopic();

    const out = await ensureOwnedWorktreeForRun(subject);

    expect(mocks.restore).toHaveBeenCalledWith(
      'tpc_1',
      expect.objectContaining({ branch: 'lobehub/quiet-hill', path: WT }),
    );
    expect(out).toBe(subject);
    expect(out?.metadata?.workingDirectoryConfig?.sessionPath).toBe(WT);
  });

  it('asks the server for a worktree on a remote device', async () => {
    mocks.isLocal.mockResolvedValue(false);
    mocks.restore.mockResolvedValue({ outcome: 'restored' });
    await ensureOwnedWorktreeForRun(restoredTopic());
    expect(mocks.statPath).not.toHaveBeenCalled();
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });

  it('falls back to the source repository when the branch is gone, and says so', async () => {
    mocks.isLocal.mockResolvedValue(false);
    mocks.restore.mockResolvedValue({ outcome: 'branchMissing' });

    const out = await ensureOwnedWorktreeForRun(restoredTopic());

    expect(out?.metadata?.workingDirectory).toBe('/code/repo');
    expect(out?.metadata?.workingDirectoryConfig).toEqual({
      path: '/code/repo',
      repoType: 'github',
    });
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tpc_1', type: 'updateTopic' }),
      expect.any(String),
    );
  });

  it('never blocks the turn on a failed restore', async () => {
    mocks.isLocal.mockResolvedValue(false);
    mocks.restore.mockResolvedValue({ error: 'fatal: boom', outcome: 'error' });
    const subject = restoredTopic();
    await expect(ensureOwnedWorktreeForRun(subject)).resolves.toBe(subject);
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'fatal: boom' }),
    );
  });
});
