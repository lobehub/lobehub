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

  /** @example A pool-authorized device owned by another member supplies its own approved roots. */
  it('uses the authorized registry row without falling back to caller ownership', async () => {
    // ROOT CAUSE:
    //
    // The legacy findByDeviceId lookup is restricted to the caller's userId.
    // A valid pool grant for another owner's machine therefore lost its roots.
    // The execution guard now forwards the exact authorized device record.
    const model = mockModel(null);
    const registered = { defaultCwd: '/workspace/approved', workingDirs: [] };
    /** @example An authorized child directory is usable. */
    await expect(
      assertWorkspaceRootApproved(model, 'shared-device', '/workspace/approved/src', registered),
    ).resolves.toBeUndefined();
    /** @example Pool use does not grant arbitrary filesystem roots. */
    await expect(
      assertWorkspaceRootApproved(model, 'shared-device', '/workspace', registered),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    /** @example Caller ownership no longer overrides the successful pool grant. */
    expect(model.findByDeviceId).not.toHaveBeenCalled();
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
  const mockWorkspaceModel = (row: object | undefined) =>
    ({
      findWorkspaceDeviceById: vi.fn().mockResolvedValue(row),
    }) as unknown as DeviceModel;

  /** @example A visible registered device remains addressable by workspace RPCs. */
  it('allows a device the caller can see', async () => {
    const model = mockWorkspaceModel({ deviceId: 'public-dev' });
    await expect(assertWorkspaceDeviceVisible(model, 'public-dev')).resolves.toBeUndefined();
  });

  /** @example A Gateway-only ghost is not authorized after its workspace row is removed. */
  it('rejects a transient device with no workspace registry row', async () => {
    const model = mockWorkspaceModel(undefined);
    await expect(assertWorkspaceDeviceVisible(model, 'transient-dev')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  /** @example Another member's private device is indistinguishable from an unknown device. */
  it("rejects another member's private device with NOT_FOUND", async () => {
    const model = mockWorkspaceModel(undefined);
    await expect(
      assertWorkspaceDeviceVisible(model, 'someone-elses-private'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
