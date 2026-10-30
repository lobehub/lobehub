import { TRPCError } from '@trpc/server';

import type { WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import type { DeviceModel } from '@/database/models/device';
import { isPathWithinRoot } from '@/server/services/deviceGateway';

export const canEditWorkspaceDevice = (
  role: WorkspaceRole | undefined,
  actorUserId: string,
  enrollerUserId: string,
): boolean => role === 'owner' || enrollerUserId === actorUserId;

/**
 * Using a workspace device (as opposed to editing its registration) is open to
 * every member once it is public; read-only viewers never operate a machine.
 */
export const canOperateWorkspaceDevice = (
  role: WorkspaceRole | undefined,
  actorUserId: string,
  row: { userId: string; visibility: 'private' | 'public' },
): boolean =>
  (row.visibility === 'public' && !!role && role !== 'viewer') ||
  canEditWorkspaceDevice(role, actorUserId, row.userId);

/** Throw unless the caller may edit this workspace device's registration. */
export const assertWorkspaceDeviceEditable = (
  role: WorkspaceRole | undefined,
  actorUserId: string,
  enrollerUserId: string,
): void => {
  if (canEditWorkspaceDevice(role, actorUserId, enrollerUserId)) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Only the enrolling member or a workspace owner can modify this device.',
  });
};

/**
 * In-memory cache of device-scoped skill preview roots, populated by
 * `listProjectSkills` and consumed by `assertWorkspaceRootApproved` to
 * authorize read-only file previews without persisting skill paths into
 * the DB (which would leak into the UI's working-directory list).
 */
const deviceSkillRoots = new Map<string, Set<string>>();

export const registerDeviceSkillRoots = (deviceId: string, roots: string[]) => {
  if (roots.length === 0) return;
  deviceSkillRoots.set(deviceId, new Set(roots));
};

/**
 * Claude Code auto-memory directories (`~/.claude/projects/<key>/memory`),
 * registered by `listClaudeCodeMemory` once the caller proved the project
 * itself is an approved root, so the Memory tab can preview and save them.
 * Each grant keeps the project it was derived from and holds only while that
 * project is still approved: removing the project from the device's working
 * directories revokes its memory too. Accumulates per device (one per project
 * and memory directory), oldest evicted past the cap.
 */
const MAX_MEMORY_ROOTS_PER_DEVICE = 50;

interface DeviceMemoryRootGrant {
  memoryDir: string;
  /** The approved working directory the memory was listed for. */
  projectRoot: string;
}

const deviceMemoryRoots = new Map<string, Map<string, DeviceMemoryRootGrant>>();

export const registerDeviceMemoryRoot = (deviceId: string, grant: DeviceMemoryRootGrant) => {
  const { memoryDir, projectRoot } = grant;
  // A memory directory that covers its own project (a repository setting
  // pointing `autoMemoryDirectory` at `~` or `/`) would widen the project's
  // grant to the whole tree.
  if (!memoryDir || !projectRoot || isPathWithinRoot(memoryDir, projectRoot)) return;

  const grants = deviceMemoryRoots.get(deviceId) ?? new Map<string, DeviceMemoryRootGrant>();
  const key = JSON.stringify([projectRoot, memoryDir]);
  grants.delete(key);
  grants.set(key, { memoryDir, projectRoot });
  if (grants.size > MAX_MEMORY_ROOTS_PER_DEVICE) grants.delete(grants.keys().next().value!);
  deviceMemoryRoots.set(deviceId, grants);
};

const isWithinSkillRoots = (deviceId: string, workingDirectory: string): boolean =>
  [...(deviceSkillRoots.get(deviceId) ?? [])].some((root) =>
    isPathWithinRoot(root, workingDirectory),
  );

const isWithinMemoryGrant = (
  deviceId: string,
  workingDirectory: string,
  isProjectApproved: (projectRoot: string) => boolean,
): boolean =>
  [...(deviceMemoryRoots.get(deviceId)?.values() ?? [])].some(
    ({ memoryDir, projectRoot }) =>
      isPathWithinRoot(memoryDir, workingDirectory) && isProjectApproved(projectRoot),
  );

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
 *
 * Use the request's authorized workspace scope for shared devices: their
 * `userId` is the enroller, not necessarily the caller. Never fall back to a
 * personal row, whose approved directories belong to a different device scope.
 */
export const assertWorkspaceRootApproved = async (
  deviceModel: DeviceModel,
  deviceId: string,
  workingDirectory: string,
  workspaceId?: string,
): Promise<void> => {
  if (!workingDirectory) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A workspace root is required for file operations',
    });
  }

  const device = workspaceId
    ? await deviceModel.findWorkspaceDeviceById(deviceId)
    : await deviceModel.findByDeviceId(deviceId);

  const approvedRoots = (device?.workingDirs ?? [])
    .flatMap((dir) => [dir.path, dir.git?.activeWorktree])
    .concat(device?.defaultCwd ? [device.defaultCwd] : [])
    .filter((root): root is string => Boolean(root));

  const isApprovedRoot = (target: string) =>
    approvedRoots.some((root) => isPathWithinRoot(root, target));
  const approved =
    isApprovedRoot(workingDirectory) ||
    isWithinSkillRoots(deviceId, workingDirectory) ||
    isWithinMemoryGrant(deviceId, workingDirectory, isApprovedRoot);

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
 * The visible registry row is also the workspace execution authority. A live
 * Gateway connection without that row can be a stale process that missed an
 * Unshare RPC, so it must fail exactly like an unknown or private device.
 *
 * Use when:
 * - A workspace-scoped RPC accepts a client-supplied logical device ID
 *
 * Expects:
 * - `deviceModel` is already scoped to the authorized workspace and caller
 *
 * Returns:
 * - Nothing for a visible registered device; otherwise throws `NOT_FOUND`
 */
export const assertWorkspaceDeviceVisible = async (
  deviceModel: DeviceModel,
  deviceId: string,
): Promise<void> => {
  const device = await deviceModel.findWorkspaceDeviceById(deviceId);
  if (!device) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace device not found.' });
  }
};
