import { TRPCError } from '@trpc/server';

import type { DeviceModel } from '@/database/models/device';
import { isPathWithinRoot } from '@/server/services/deviceGateway';

/**
 * Validate that a client-supplied workspace root is actually one the user has
 * bound to this device.
 *
 * The file routes (move / rename / write / preview) receive `workingDirectory`
 * from the same untrusted browser session that supplies the file paths. The
 * gateway's `assertPathsWithinWorkspace` only proves the paths sit *inside that
 * directory* — it never proves the directory itself is legitimate. So a caller
 * could set `workingDirectory` to `/` (or `C:\`), pass that containment check
 * trivially, and reach any path on the device.
 *
 * To close that hole we re-derive the approved roots from the *server-owned*
 * device row — the `workingDirs` recent list and `defaultCwd`, both written only
 * via `device.updateDevice` / the run path, never trusted from this request —
 * and require the requested root to equal or nest inside one of them before any
 * RPC is forwarded. The picker upserts every chosen directory into `workingDirs`
 * (see `useCommitWorkingDirectory`) and run start upserts the bound cwd, so a
 * legitimately-selected workspace is always present here.
 */
export const assertWorkspaceRootApproved = async (
  deviceModel: DeviceModel,
  deviceId: string,
  workingDirectory: string,
): Promise<void> => {
  if (!workingDirectory) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A workspace root is required for file operations',
    });
  }

  const device = await deviceModel.findByDeviceId(deviceId);

  const approvedRoots = [
    ...(device?.workingDirs ?? []).map((dir) => dir.path),
    ...(device?.defaultCwd ? [device.defaultCwd] : []),
  ].filter((root): root is string => Boolean(root));

  const approved = approvedRoots.some((root) => isPathWithinRoot(root, workingDirectory));

  if (!approved) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Working directory is not an approved workspace for this device',
    });
  }
};

/**
 * Enforce the workspace device-visibility boundary for RPC routes.
 *
 * The gateway pool is addressed by workspace principal + deviceId and knows
 * nothing about visibility, so filtering the LIST paths is not enough — a
 * member holding another member's private deviceId (cached response,
 * pre-demotion state) could still drive tool/git/file RPCs against that
 * machine. Called once from `deviceProcedure` for every route that takes a
 * `deviceId` input: a workspace-scoped call against a device hidden from the
 * caller fails closed with the same NOT_FOUND an unknown device produces.
 *
 * Personal deviceIds are never in the hidden set (different hash domain), and
 * transient gateway-only devices (no DB row) are public by definition.
 */
export const assertWorkspaceDeviceVisible = async (
  deviceModel: DeviceModel,
  deviceId: string,
): Promise<void> => {
  const hiddenIds = await deviceModel.queryWorkspaceHiddenDeviceIds();
  if (hiddenIds.includes(deviceId)) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace device not found.' });
  }
};
