import { workingDirConfigSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  type WorkspaceRole,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeviceModel, WorkspaceDevicePrivateConflictError } from '@/database/models/device';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signWorkspaceDeviceToken } from '@/libs/trpc/utils/internalJwt';
import { deviceGateway } from '@/server/services/deviceGateway';

import { preserveWorkspaceCache } from '../deviceWorkingDirs';
import { assertWorkspaceDeviceEditable, canEditWorkspaceDevice } from '../deviceWorkspaceGuard';

/**
 * Fixed workspace agents promise every member the same execution device. Keep
 * that promise intact until an editor changes the agent back to member choice
 * (or binds a different public device) before hiding/removing this row.
 */
const assertDeviceNotBoundToFixedAgent = async (
  model: DeviceModel,
  deviceId: string,
): Promise<void> => {
  if (!(await model.hasFixedAgentBinding(deviceId))) return;

  throw new TRPCError({
    cause: { data: { code: 'DeviceBoundToFixedAgent' } },
    code: 'PRECONDITION_FAILED',
    message:
      'This device is fixed to one or more workspace agents. Change those agent settings first.',
  });
};

/**
 * Workspace-write gate: membership + at least `member` role (excludes viewer).
 * Enrolling a device mutates the shared workspace device pool, so read-only
 * viewers must not pass — `wsProcedure` alone only checks membership.
 */
const wsWritableProcedure = wsProcedure.use(requireWorkspaceRole('member'));

export const workspaceProcedures = {
  /**
   * Mint a short-lived connect token for enrolling a WORKSPACE-owned device.
   * Workspace members (and owners) can call — enrolling a machine into the
   * shared pool is self-service so members don't have to chase an owner to
   * join their dev box. Viewers are blocked: writing a row to the workspace
   * device pool is a mutation, not a read. The signed token carries the
   * `workspace_id` claim the device gateway trusts to route the device to the
   * `workspace:<id>` principal. The CLI (`lh connect --workspace`) / settings
   * page use this.
   */
  mintWorkspaceConnectToken: wsWritableProcedure.mutation(async ({ ctx }) => {
    const token = await signWorkspaceDeviceToken(ctx.workspaceId);
    return { token, workspaceId: ctx.workspaceId };
  }),
  /**
   * Enroll the calling machine as a device of the current workspace.
   * Workspace members (and owners) may call — viewers are blocked because
   * enrollment writes a row to the shared pool. `devices.userId` records the
   * first enroller of each `(workspaceId, deviceId)` pair and is preserved on
   * re-enroll (see `DeviceModel.registerWorkspaceDevice`), which
   * `updateWorkspaceDevice` / `removeWorkspaceDevice` use to gate writes to
   * "self or owner". Used by `lh connect --workspace` after minting the
   * connect token.
   */
  registerWorkspaceDevice: wsWritableProcedure
    .use(serverDatabase)
    .input(
      z.object({
        architecture: z.string().max(20).nullish(),
        deviceId: z.string().min(1).max(64),
        hostname: z.string().nullish(),
        identitySource: z.enum(['machine-id', 'fallback']),
        /** Extensible client-reported info bag; free-form, size-capped to guard the column. */
        metadata: z
          .record(z.string().max(64), z.string().max(200))
          .refine((m) => Object.keys(m).length <= 20, 'metadata supports at most 20 keys')
          .nullish(),
        platform: z.string().max(20).nullish(),
        // 'private' enrolls the device for the calling member only (settings
        // page "Private" tab / `lh connect --workspace <id> --private`);
        // defaults to the shared pool. Preserved on re-enroll — see
        // `DeviceModel.registerWorkspaceDevice`.
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      try {
        return await model.registerWorkspaceDevice({ ...input, workspaceId: ctx.workspaceId });
      } catch (error) {
        if (error instanceof WorkspaceDevicePrivateConflictError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        throw error;
      }
    }),
  /**
   * Share one of the caller's PERSONAL devices into the current workspace
   * without touching the machine: dispatch an `enrollWorkspace` RPC over the
   * device's live personal connection (it derives its workspace-scoped
   * deviceId and opens a second gateway connection with the minted token),
   * then register the workspace row here — linked back to the personal device
   * via `sharedFromDeviceId` so the personal list can render and revoke the
   * share. Requires the device to be ONLINE; an offline device fails with
   * PRECONDITION_FAILED and the UI keeps its share action disabled.
   *
   * Same write gate as enrolling on the machine (`wsWritableProcedure`:
   * member+, viewers blocked). Visibility defaults to 'private' — see
   * `DeviceModel.registerWorkspaceDevice`.
   *
   * The machine may ALREADY be enrolled in this workspace (e.g. via
   * `lh connect --workspace`, which the personal share map can't link to).
   * Silently upserting would discard the caller's explicit visibility choice
   * (the conflict branch preserves the existing value), so instead the first
   * call reports `alreadyEnrolled` without writing; a `confirmOverwrite`
   * retry applies the requested visibility and links the row back to the
   * personal device.
   */
  shareDeviceToWorkspace: wsWritableProcedure
    .use(serverDatabase)
    .input(
      z.object({
        confirmOverwrite: z.boolean().optional(),
        deviceId: z.string().min(1).max(64),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const personal = await model.findByDeviceId(input.deviceId);
      // findByDeviceId is (userId, deviceId)-scoped; exclude workspace rows the
      // caller enrolled so only true personal devices are shareable.
      if (!personal || personal.workspaceId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Personal device not found.' });
      }

      const token = await signWorkspaceDeviceToken(ctx.workspaceId);
      // Identity-only probe: learn the machine's workspace deviceId WITHOUT the
      // device opening or persisting a share connection, so backing out of the
      // overwrite confirmation leaves the device untouched. Older clients
      // ignore the flag and enroll here — that degrades to the pre-flag
      // behaviour, never worse.
      const probe = await deviceGateway.enrollWorkspace({
        deviceId: personal.deviceId,
        identityOnly: true,
        token,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      if (!probe.success || !probe.identity) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: probe.error ?? 'Device is offline or does not support workspace sharing.',
        });
      }

      // Fail a cross-user PRIVATE collision NOW, before the machine opens and
      // persists a workspace share connection — rejecting only at the later
      // row write would leave the device connected (and auto-reconnecting)
      // under the very id the rejection protects.
      try {
        await model.assertNoCrossUserPrivateConflict(probe.identity.deviceId);
      } catch (error) {
        if (error instanceof WorkspaceDevicePrivateConflictError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        throw error;
      }

      // Caller-invisible rows (another member's private enrollment) were
      // rejected above, so an undefined here really means "no row yet".
      const existing = await model.findWorkspaceDeviceById(probe.identity.deviceId);
      if (existing) {
        if (!input.confirmOverwrite) {
          return {
            alreadyEnrolled: true as const,
            deviceId: existing.deviceId,
            success: false as const,
            visibility: existing.visibility,
          };
        }
        const role = (ctx as { workspaceRole?: WorkspaceRole }).workspaceRole;
        if (!canEditWorkspaceDevice(role, ctx.userId, existing.userId)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the enrolling member or a workspace owner can overwrite this device.',
          });
        }
        if ((input.visibility ?? 'private') === 'private') {
          await assertDeviceNotBoundToFixedAgent(model, existing.deviceId);
        }
      }

      // Real enrollment — only after the caller is committed (no pending
      // confirmation and permission checks passed).
      const result = await deviceGateway.enrollWorkspace({
        deviceId: personal.deviceId,
        token,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      if (!result.success || !result.identity) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: result.error ?? 'Device is offline or does not support workspace sharing.',
        });
      }

      if (existing) {
        const row = await model.overwriteSharedWorkspaceDevice(existing.deviceId, {
          sharedFromDeviceId: personal.deviceId,
          visibility: input.visibility ?? 'private',
        });
        if (personal.friendlyName && !row?.friendlyName) {
          await model.updateWorkspaceDevice(existing.deviceId, {
            friendlyName: personal.friendlyName,
          });
        }
        return {
          deviceId: existing.deviceId,
          success: true as const,
          visibility: row?.visibility ?? input.visibility ?? 'private',
        };
      }

      let row;
      try {
        row = await model.registerWorkspaceDevice({
          deviceId: result.identity.deviceId,
          hostname: personal.hostname,
          identitySource: result.identity.identitySource,
          platform: personal.platform,
          sharedFromDeviceId: personal.deviceId,
          visibility: input.visibility,
          workspaceId: ctx.workspaceId,
        });
      } catch (error) {
        // The machine has already opened and persisted a share connection
        // above, and this (private-by-default) row is what hides it from other
        // members — on ANY write failure (conflict race, transient DB error),
        // best-effort roll the connection back so it doesn't linger as an
        // unregistered workspace ghost, then surface the original error.
        await deviceGateway.unenrollWorkspace({
          deviceId: result.identity.deviceId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        if (error instanceof WorkspaceDevicePrivateConflictError) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        throw error;
      }
      // Carry the personal alias over on first share so the workspace list shows
      // the machine under the name its owner gave it; never clobber a name a
      // re-share conflict-preserved.
      if (personal.friendlyName && !row.friendlyName) {
        await model.updateWorkspaceDevice(row.deviceId, { friendlyName: personal.friendlyName });
      }

      return { deviceId: row.deviceId, success: true as const, visibility: row.visibility };
    }),
  /**
   * Publish a private workspace device to the shared pool, or pull a public one
   * back to private. Mirrors the agent/file `setVisibility` contract:
   *   - the enrolling member may toggle their own device both ways;
   * - nobody else may touch visibility: owners demoting another
   *     member's public device would appropriate it into that member's private
   *     list, and other members' private devices are invisible to everyone
   *     else by design (the lookup below already fails closed with NOT_FOUND),
   *     so the whole toggle is effectively enroller-only.
   */
  setWorkspaceDeviceVisibility: wsWritableProcedure
    .use(serverDatabase)
    .input(
      z.object({
        deviceId: z.string(),
        visibility: z.enum(['private', 'public']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const row = await model.findWorkspaceDeviceById(input.deviceId);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace device not found.' });
      }
      if (row.visibility === input.visibility) return { success: true };
      if (row.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the enrolling member can change this device visibility.',
        });
      }
      if (input.visibility === 'private') {
        await assertDeviceNotBoundToFixedAgent(model, input.deviceId);
      }
      await model.setWorkspaceDeviceVisibility(input.deviceId, input.visibility);
      return { success: true };
    }),
  /**
   * Rename / replace the working dirs of a WORKSPACE device (enroller or owner only).
   * Members edit one recent dir via `workspaceDeviceWorkingDirProcedures`.
   */
  updateWorkspaceDevice: wsWritableProcedure
    .use(serverDatabase)
    .input(
      z.object({
        defaultCwd: z.string().nullish(),
        deviceId: z.string(),
        friendlyName: z.string().max(100).nullish(),
        workingDirs: z.array(workingDirConfigSchema).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const { deviceId, workingDirs, ...value } = input;
      const row = await model.findWorkspaceDeviceById(deviceId);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace device not found.' });
      }
      const role = (ctx as { workspaceRole?: WorkspaceRole }).workspaceRole;
      assertWorkspaceDeviceEditable(role, ctx.userId, row.userId);
      const nextWorkingDirs = workingDirs
        ? preserveWorkspaceCache(workingDirs, row.workingDirs ?? [])
        : undefined;
      await model.updateWorkspaceDevice(deviceId, { ...value, workingDirs: nextWorkingDirs });
      return { success: true };
    }),
  /**
   * Remove a WORKSPACE device. Scoped by `workspace_id` and gated by
   * {@link canEditWorkspaceDevice}: owners may remove any device in the pool;
   * members may remove only devices they enrolled themselves.
   */
  removeWorkspaceDevice: wsWritableProcedure
    .use(serverDatabase)
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const row = await model.findWorkspaceDeviceById(input.deviceId);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace device not found.' });
      }
      const role = (ctx as { workspaceRole?: WorkspaceRole }).workspaceRole;
      if (!canEditWorkspaceDevice(role, ctx.userId, row.userId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the enrolling member or a workspace owner can remove this device.',
        });
      }
      await assertDeviceNotBoundToFixedAgent(model, input.deviceId);
      // Tell a live device to drop its workspace connection and stop
      // auto-reconnecting, so removal doesn't leave an online ghost. For most
      // rows this stays best-effort — an offline device simply stops resolving.
      const unenrolled = await deviceGateway.unenrollWorkspace({
        deviceId: input.deviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      // But never delete the row under a still-live socket that did not
      // acknowledge the unenroll (old client without the handler, RPC error):
      // for a PRIVATE row that would resurface the machine to other members
      // (the row is the only thing `queryWorkspaceHiddenDeviceIds` hides it
      // by), and for ANY row it leaves an unregistered ghost that members can
      // still dispatch to yet can no longer remove — there is no row left to
      // delete. Fail the removal while the socket is demonstrably alive; a
      // dead socket can't ghost, so an offline device still deletes fine.
      if (!unenrolled.success) {
        const online = await deviceGateway.queryDeviceList(ctx.userId, ctx.workspaceId);
        if (online.some((d) => d.deviceId === input.deviceId)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'The device is still connected but did not acknowledge the unenroll — retry once it has disconnected or updated its client.',
          });
        }
      }
      await model.deleteWorkspaceDevice(input.deviceId);
      return { success: true };
    }),
};
