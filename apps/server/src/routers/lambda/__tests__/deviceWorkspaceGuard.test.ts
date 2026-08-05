import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import type { DeviceModel } from '@/database/models/device';

import { assertWorkspaceDeviceVisible, assertWorkspaceRootApproved } from '../deviceWorkspaceGuard';

const mockModel = (row: { defaultCwd?: string | null; workingDirs?: { path: string }[] } | null) =>
  ({
    findByDeviceId: vi.fn().mockResolvedValue(row),
  }) as unknown as DeviceModel;

describe('assertWorkspaceRootApproved', () => {
  it('allows a root that exactly matches a bound workingDir', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj'),
    ).resolves.toBeUndefined();
  });

  it('allows a root nested inside a bound workingDir', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj/packages/app'),
    ).resolves.toBeUndefined();
  });

  it('allows a root matching defaultCwd when no workingDirs match', async () => {
    const model = mockModel({ defaultCwd: '/Users/me/default', workingDirs: [] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/default'),
    ).resolves.toBeUndefined();
  });

  it('rejects a root that escapes the approved roots (filesystem root)', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(assertWorkspaceRootApproved(model, 'dev-1', '/')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects a sibling directory that shares a path prefix but is not contained', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj-evil'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects when the device has no approved roots at all', async () => {
    const model = mockModel({ workingDirs: [] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects when the device row is missing', async () => {
    const model = mockModel(null);
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj'),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('rejects an empty workspace root with BAD_REQUEST before hitting the DB', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(assertWorkspaceRootApproved(model, 'dev-1', '')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(model.findByDeviceId).not.toHaveBeenCalled();
  });
});

describe('assertWorkspaceDeviceVisible', () => {
  const mockHiddenModel = (hiddenIds: string[]) =>
    ({
      queryWorkspaceHiddenDeviceIds: vi.fn().mockResolvedValue(hiddenIds),
    }) as unknown as DeviceModel;

  it('allows a device the caller can see', async () => {
    const model = mockHiddenModel(['someone-elses-private']);
    await expect(assertWorkspaceDeviceVisible(model, 'public-dev')).resolves.toBeUndefined();
  });

  it('allows a transient device with no DB row (empty hidden set)', async () => {
    const model = mockHiddenModel([]);
    await expect(assertWorkspaceDeviceVisible(model, 'transient-dev')).resolves.toBeUndefined();
  });

  it("rejects another member's private device with NOT_FOUND", async () => {
    const model = mockHiddenModel(['someone-elses-private']);
    await expect(
      assertWorkspaceDeviceVisible(model, 'someone-elses-private'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
