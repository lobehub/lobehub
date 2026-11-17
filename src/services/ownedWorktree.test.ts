import type { OwnedWorktree } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  deviceId: 'dev-local' as string | undefined,
  discard: vi.fn(),
  ipcCleanup: vi.fn(),
  ipcRestore: vi.fn(),
  isDesktop: true,
  keep: vi.fn(),
  report: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get isDesktop() {
    return mocks.isDesktop;
  },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    topic: {
      claimLocalWorktreeCleanups: { mutate: mocks.claim },
      discardOwnedWorktree: { mutate: mocks.discard },
      keepOwnedWorktree: { mutate: mocks.keep },
      reportOwnedWorktreeCleanup: { mutate: mocks.report },
      restoreOwnedWorktree: { mutate: mocks.restore },
    },
  },
}));
vi.mock('@/services/electron/git', () => ({
  electronGitService: {
    cleanupOwnedWorktree: mocks.ipcCleanup,
    restoreOwnedWorktree: mocks.ipcRestore,
  },
}));
vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ resolveGatewayDeviceId: async () => mocks.deviceId }),
}));

const {
  discardOwnedWorktree,
  drainLocalWorktreeCleanups,
  isLocalOwnedWorktree,
  restoreOwnedWorktree,
} = await import('./ownedWorktree');

const WT = '/Users/me/.lobehub/worktrees/repo-1a2b3c4d/quiet-hill';
const entry = (deviceId?: string): OwnedWorktree => ({
  branch: 'lobehub/quiet-hill',
  createdAt: 'y',
  ...(deviceId && { deviceId }),
  path: WT,
  sourcePath: '/code/repo',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isDesktop = true;
  mocks.deviceId = 'dev-local';
});

describe('isLocalOwnedWorktree', () => {
  it('is this desktop for its own device id or a record without one', async () => {
    await expect(isLocalOwnedWorktree(entry('dev-local'))).resolves.toBe(true);
    await expect(isLocalOwnedWorktree(entry())).resolves.toBe(true);
    await expect(isLocalOwnedWorktree(entry('dev-remote'))).resolves.toBe(false);
  });

  it('is never local on the web', async () => {
    mocks.isDesktop = false;
    await expect(isLocalOwnedWorktree(entry())).resolves.toBe(false);
  });
});

describe('drainLocalWorktreeCleanups', () => {
  it('runs each claimed cleanup over IPC and reports the result', async () => {
    mocks.claim.mockResolvedValue([
      {
        discard: false,
        entry: {
          ...entry(),
          cleanup: { at: 'x', state: 'running', trigger: 'trashed' },
          ownerToken: 'receipt-0123456789abcdef',
        },
        topicId: 't1',
      },
    ]);
    mocks.ipcCleanup.mockResolvedValue({ dirtyFiles: 2, outcome: 'dirty' });

    await expect(drainLocalWorktreeCleanups()).resolves.toBe(1);

    expect(mocks.claim).toHaveBeenCalledWith({ deviceId: 'dev-local' });
    expect(mocks.ipcCleanup).toHaveBeenCalledWith({
      discard: false,
      ownerToken: 'receipt-0123456789abcdef',
      sourcePath: '/code/repo',
      worktreePath: WT,
    });
    expect(mocks.report).toHaveBeenCalledWith({
      path: WT,
      result: { branch: undefined, dirtyFiles: 2, error: undefined, outcome: 'dirty' },
      topicId: 't1',
      trigger: 'trashed',
    });
  });

  it('does nothing on the web', async () => {
    mocks.isDesktop = false;
    await expect(drainLocalWorktreeCleanups()).resolves.toBe(0);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});

describe('discardOwnedWorktree', () => {
  it('claims on the server and deletes over IPC for this desktop', async () => {
    mocks.discard.mockResolvedValue({ ...entry('dev-local'), cleanup: { state: 'running' } });
    mocks.ipcCleanup.mockResolvedValue({ outcome: 'removed' });
    mocks.report.mockResolvedValue({ ...entry('dev-local'), cleanup: { state: 'removed' } });

    const written = await discardOwnedWorktree('t1', entry('dev-local'));

    expect(mocks.discard).toHaveBeenCalledWith({ local: true, path: WT, topicId: 't1' });
    expect(mocks.ipcCleanup).toHaveBeenCalledWith(expect.objectContaining({ discard: true }));
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'discarded' }));
    expect(written?.cleanup?.state).toBe('removed');
  });

  it('lets the server run it on a remote device', async () => {
    await discardOwnedWorktree('t1', entry('dev-remote'));
    expect(mocks.discard).toHaveBeenCalledWith({ path: WT, topicId: 't1' });
    expect(mocks.ipcCleanup).not.toHaveBeenCalled();
  });
});

describe('restoreOwnedWorktree', () => {
  it('lets the server decide, then re-adds a worktree on this desktop over IPC', async () => {
    mocks.restore
      .mockResolvedValueOnce({ branch: 'lobehub/renamed', outcome: 'needsLocal' })
      .mockResolvedValueOnce({ outcome: 'restored' });
    mocks.ipcRestore.mockResolvedValue({ outcome: 'restored' });

    await expect(restoreOwnedWorktree('t1', entry())).resolves.toEqual({ outcome: 'restored' });
    expect(mocks.restore).toHaveBeenNthCalledWith(1, { local: true, path: WT, topicId: 't1' });
    // The branch the server last recorded wins over the stale list row.
    expect(mocks.ipcRestore).toHaveBeenCalledWith({
      branch: 'lobehub/renamed',
      sourcePath: '/code/repo',
      worktreePath: WT,
    });
    expect(mocks.restore).toHaveBeenNthCalledWith(2, {
      path: WT,
      result: { error: undefined, outcome: 'restored' },
      topicId: 't1',
    });
  });

  it('passes a busy or already-restored answer straight through', async () => {
    mocks.restore.mockResolvedValue({ outcome: 'busy' });
    await expect(restoreOwnedWorktree('t1', entry())).resolves.toEqual({ outcome: 'busy' });
    expect(mocks.ipcRestore).not.toHaveBeenCalled();
  });

  it('asks the server to run it on a remote device', async () => {
    mocks.restore.mockResolvedValue({ outcome: 'restored' });
    await restoreOwnedWorktree('t1', entry('dev-remote'));
    expect(mocks.ipcRestore).not.toHaveBeenCalled();
    expect(mocks.restore).toHaveBeenCalledWith({ local: false, path: WT, topicId: 't1' });
  });
});
