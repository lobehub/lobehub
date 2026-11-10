// @vitest-environment node
import { deriveWorktreePath } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({ addGitWorktree: vi.fn(), queryDeviceSystemInfo: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    addGitWorktree: mocks.addGitWorktree,
    queryDeviceSystemInfo: mocks.queryDeviceSystemInfo,
  },
}));

/**
 * The server re-derives the target from the trusted `path` + `branch` instead of
 * accepting one from the client, and must land on the same central folder the
 * renderer previews, rooted at the home directory the device reports.
 */
describe('device.addGitWorktree', () => {
  const caller = deviceRouter.createCaller({ userId: 'user' } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addGitWorktree.mockResolvedValue({ success: true });
    mocks.queryDeviceSystemInfo.mockResolvedValue({ homePath: '/Users/me' });
  });

  it('sends the central worktree path the renderer previews', async () => {
    await caller.addGitWorktree({ branch: 'feat/x', deviceId: 'device', path: '/code/lobehub' });

    const { worktreePath } = mocks.addGitWorktree.mock.calls[0][0];
    expect(worktreePath).toBe(
      deriveWorktreePath('/code/lobehub', 'feat/x', { homeDir: '/Users/me' }),
    );
    expect(worktreePath).toMatch(/^\/Users\/me\/\.lobehub\/worktrees\/lobehub-[\da-f]{8}\/feat-x$/);
    expect(mocks.queryDeviceSystemInfo).toHaveBeenCalledWith('user', 'device', undefined, {
      maxAgeMs: expect.any(Number),
    });
  });

  // From a linked worktree the client sends the main checkout as `sourcePath`,
  // and both sides key the folder on it.
  it('keys the folder on sourcePath when the call comes from a linked worktree', async () => {
    await caller.addGitWorktree({
      branch: 'feat/x',
      deviceId: 'device',
      path: '/Users/me/.lobehub/worktrees/lobehub-0000beef/feat-a',
      sourcePath: '/code/lobehub',
    });

    expect(mocks.addGitWorktree.mock.calls[0][0]).toMatchObject({
      path: '/Users/me/.lobehub/worktrees/lobehub-0000beef/feat-a',
      worktreePath: deriveWorktreePath('/code/lobehub', 'feat/x', { homeDir: '/Users/me' }),
    });
  });

  it('falls back to the sibling layout when the device reports no home', async () => {
    mocks.queryDeviceSystemInfo.mockResolvedValue(undefined);

    await caller.addGitWorktree({ branch: 'feat/x', deviceId: 'device', path: '/code/lobehub' });

    expect(mocks.addGitWorktree.mock.calls[0][0].worktreePath).toBe('/code/lobehub-feat-x');
  });

  it('ignores a client-supplied absolute target', async () => {
    await caller.addGitWorktree({
      branch: 'feat/x',
      deviceId: 'device',
      path: '/code/lobehub',
      worktreePath: '/etc/evil',
    } as never);

    expect(mocks.addGitWorktree.mock.calls[0][0].worktreePath).toBe(
      deriveWorktreePath('/code/lobehub', 'feat/x', { homeDir: '/Users/me' }),
    );
  });

  it('keeps the sibling fallback next to the repo git runs in, not a client sourcePath', async () => {
    mocks.queryDeviceSystemInfo.mockResolvedValue(undefined);

    await caller.addGitWorktree({
      branch: 'feat/x',
      deviceId: 'device',
      path: '/code/lobehub',
      sourcePath: '/Users/me/.ssh/x',
    });

    expect(mocks.addGitWorktree.mock.calls[0][0].worktreePath).toBe('/code/lobehub-feat-x');
  });
});
