import type { ChatTopicMetadata } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatTopic } from '@/types/topic';

import { ensureOwnedWorktreeForRun } from './ownedWorktreeRestore';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  isDesktop: true,
  restore: vi.fn(),
  toastClose: vi.fn(),
  toastError: vi.fn(),
  toastLoading: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get isDesktop() {
    return mocks.isDesktop;
  },
}));
vi.mock('@lobehub/ui', () => ({
  toast: {
    error: mocks.toastError,
    loading: (...args: unknown[]) => {
      mocks.toastLoading(...args);
      return { close: mocks.toastClose };
    },
    warning: mocks.toastWarning,
  },
}));
vi.mock('@/services/ownedWorktree', () => ({
  restoreOwnedWorktree: mocks.restore,
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

  it('runs the turn as is when the server says the worktree is there', async () => {
    mocks.restore.mockResolvedValue({ outcome: 'restored' });
    const subject = restoredTopic();
    await expect(ensureOwnedWorktreeForRun(subject)).resolves.toBe(subject);
    expect(mocks.restore).toHaveBeenCalledWith(
      'tpc_1',
      expect.objectContaining({ branch: 'lobehub/quiet-hill', path: WT }),
    );
    expect(subject.metadata?.workingDirectoryConfig?.sessionPath).toBe(WT);
  });

  it('waits while the archive cleanup is still deleting the folder, then restores it', async () => {
    vi.useFakeTimers();
    try {
      mocks.restore
        .mockResolvedValueOnce({ outcome: 'busy' })
        .mockResolvedValueOnce({ outcome: 'busy' })
        .mockResolvedValueOnce({ outcome: 'restored' });
      const subject = restoredTopic();
      const pending = ensureOwnedWorktreeForRun(subject);
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toBe(subject);
      expect(mocks.restore).toHaveBeenCalledTimes(3);
      expect(mocks.toastLoading).toHaveBeenCalledTimes(1);
      expect(mocks.toastClose).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the source repository when the branch is gone, and says so', async () => {
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
    mocks.restore.mockResolvedValue({ error: 'fatal: boom', outcome: 'error' });
    const subject = restoredTopic();
    await expect(ensureOwnedWorktreeForRun(subject)).resolves.toBe(subject);
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'fatal: boom' }),
    );
  });
});
