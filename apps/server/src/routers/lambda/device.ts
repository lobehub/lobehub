import { REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
import type {
  DeviceChannel,
  DeviceListItem,
  DeviceScope,
  DeviceWorkspaceShare,
  WorkingDirEntry,
} from '@lobechat/types';
import { deriveWorktreePath, sortDevicesByActivity, workingDirConfigSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  type WorkspaceRole,
  wsCompatProcedure,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeviceModel, WorkspaceDevicePrivateConflictError } from '@/database/models/device';
import { UserModel } from '@/database/models/user';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signWorkspaceDeviceToken } from '@/libs/trpc/utils/internalJwt';
import { type DeviceAttachment, deviceGateway } from '@/server/services/deviceGateway';

import { preserveWorkspaceCache } from './deviceWorkingDirs';
import { assertWorkspaceDeviceVisible, assertWorkspaceRootApproved } from './deviceWorkspaceGuard';

// Derive the zod enum from the canonical config so new platforms are
// automatically covered without touching this file.
const remotePlatformEnum = z.enum(
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((c) => c.type) as [
    (typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'],
    ...(typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'][],
  ],
);

const CAPABILITY_TIMEOUT_MS = 5_000;
const PROFILE_TIMEOUT_MS = 5_000;

/**
 * A workspace device's user-editable fields (rename, working dirs, remove) may
 * be modified by:
 *   1. any workspace owner — managing shared infra is an owner privilege, OR
 *   2. the workspace member who originally enrolled the device (`devices.userId`
 *      stores the first enroller for workspace rows, never overwritten on
 *      re-enroll — see `DeviceModel.registerWorkspaceDevice`).
 *
 * Members can therefore self-serve their own machines without touching anyone
 * else's enrollment, while shared cleanup remains an owner action.
 */
const canEditWorkspaceDevice = (
  role: WorkspaceRole | undefined,
  actorUserId: string,
  enrollerUserId: string,
): boolean => role === 'owner' || enrollerUserId === actorUserId;

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

// Workspace-aware (compat): with an `X-Workspace-Id` header the device list also
// surfaces the workspace's shared devices; without it, the personal path is
// unchanged (`ctx.workspaceId === undefined`).
//
// Every route below that takes a `deviceId` input also passes the workspace
// visibility gate — see `assertWorkspaceDeviceVisible` for why filtering the
// list paths alone is not enough.
const deviceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  const deviceModel = new DeviceModel(ctx.serverDB, ctx.userId, wsId);

  if (wsId) {
    const raw = (await opts.getRawInput()) as { deviceId?: unknown } | undefined;
    if (typeof raw?.deviceId === 'string') {
      await assertWorkspaceDeviceVisible(deviceModel, raw.deviceId);
    }
  }

  return opts.next({
    ctx: {
      deviceModel,
      userId: ctx.userId,
      workspaceId: wsId,
    },
  });
});

const workspaceFileInput = z.object({
  deviceId: z.string(),
  workingDirectory: z.string(),
});

/**
 * `deviceProcedure` that additionally requires `workingDirectory` to be an
 * approved workspace root for the device. Builds the guard into the procedure
 * so every file-mutating route inherits it and can never forget the check —
 * see {@link assertWorkspaceRootApproved} for why the check is necessary.
 */
const workspaceFileProcedure = deviceProcedure.input(workspaceFileInput).use(async (opts) => {
  const { deviceId, workingDirectory } = workspaceFileInput.parse(await opts.getRawInput());
  await assertWorkspaceRootApproved(opts.ctx.deviceModel, deviceId, workingDirectory);
  return opts.next();
});

export const deviceRouter = router({
  /**
   * Probe whether a specific agent platform (openclaw / hermes) is available
   * on the given device. Dispatches a `checkPlatformCapability` tool call to
   * the device via the gateway and waits up to 5 s for a response.
   */
  checkCapability: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        platform: remotePlatformEnum,
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.executeToolCall(
        { deviceId: input.deviceId, userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          apiName: 'checkPlatformCapability',
          arguments: JSON.stringify({ platform: input.platform }),
          identifier: 'local',
        },
        CAPABILITY_TIMEOUT_MS,
      );

      if (!result.success) {
        return { available: false, reason: result.error ?? 'Device tool call failed' };
      }

      try {
        return JSON.parse(result.content) as {
          available: boolean;
          reason?: string;
          version?: string;
        };
      } catch {
        return { available: false, reason: 'Invalid response from device' };
      }
    }),

  /**
   * Granular git reads for a directory on a remote device, each via its own
   * device RPC so the web/remote git status bar mirrors the local desktop's
   * separate, differently-cadenced SWR hooks. Return `null` when offline / the
   * directory isn't a git repo.
   */
  gitBranch: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  gitLinkedPullRequest: deviceProcedure
    .input(
      z.object({
        branch: z.string(),
        deviceId: z.string(),
        path: z.string(),
        pullRequestNumber: z.number().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitLinkedPullRequest({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
        pullRequestNumber: input.pullRequestNumber,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  gitWorkingTreeStatus: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitWorkingTreeStatus({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  gitAheadBehind: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitAheadBehind({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  /** Query OpenCode's model catalog on the device that will execute the agent. */
  listHeterogeneousAgentModels: deviceProcedure
    .input(
      z.object({
        command: z.string().optional(),
        cwd: z.string().optional(),
        deviceId: z.string(),
        env: z.record(z.string(), z.string()).optional(),
        type: z.literal('opencode'),
      }),
    )
    .query(async ({ ctx, input }) =>
      deviceGateway.listHeterogeneousAgentModels({
        command: input.command,
        cwd: input.cwd,
        deviceId: input.deviceId,
        env: input.env,
        type: input.type,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),

  /**
   * List the git worktrees attached to the same repository as a directory on a
   * remote device, via the device's `listGitWorktrees` RPC. Lets the web/remote
   * worktree picker mirror the local desktop's, populated over IPC.
   */
  listGitWorktrees: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitWorktrees({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? [];
    }),

  /**
   * List the local branches of a directory on a remote device, via the device's
   * `listGitBranches` RPC. Lets the web/remote branch switcher populate the same
   * dropdown the local desktop renders over IPC.
   */
  listGitBranches: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitBranches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? [];
    }),

  /**
   * Checkout (or create) a branch in a directory on a remote device, via the
   * device's `checkoutGitBranch` RPC.
   */
  checkoutGitBranch: deviceProcedure
    .input(
      z.object({
        branch: z.string(),
        create: z.boolean().optional(),
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.checkoutGitBranch({
        branch: input.branch,
        create: input.create,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),

  /**
   * Rename a branch in a directory on a remote device, via the device's
   * `renameGitBranch` RPC.
   */
  renameGitBranch: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        from: z.string(),
        path: z.string(),
        to: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.renameGitBranch({
        deviceId: input.deviceId,
        from: input.from,
        path: input.path,
        to: input.to,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),

  /**
   * Delete a branch in a directory on a remote device, via the device's
   * `deleteGitBranch` RPC.
   */
  deleteGitBranch: deviceProcedure
    .input(
      z.object({
        branch: z.string(),
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.deleteGitBranch({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),

  /**
   * Remove a worktree in a directory's repository on a remote device,
   * via the device's `removeGitWorktree` RPC.
   */
  removeGitWorktree: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        path: z.string(),
        worktreePath: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.removeGitWorktree({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        worktreePath: input.worktreePath,
      }),
    ),

  /**
   * Add a linked worktree on a fresh branch in a directory's repository on a
   * remote device, via the device's `addGitWorktree` RPC.
   *
   * The target directory is derived here from the trusted `path` + `branch`
   * (a `<repo>-<branch>` sibling) rather than accepted from the request, so a
   * crafted web call can't ask the device to check out at an arbitrary absolute
   * path — the branch is folded to `-` in the folder name, so it can't traverse.
   */
  addGitWorktree: deviceProcedure
    .input(
      z.object({
        branch: z.string(),
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.addGitWorktree({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        worktreePath: deriveWorktreePath(input.path, input.branch),
      }),
    ),

  /**
   * Pull (`--ff-only`) the current branch of a directory on a remote device, via
   * the device's `pullGitBranch` RPC.
   */
  pullGitBranch: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.pullGitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),

  /**
   * Push the current branch of a directory on a remote device, via the device's
   * `pushGitBranch` RPC.
   */
  pushGitBranch: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.pushGitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),

  /**
   * Working-tree (unstaged) per-file patches for a directory on a remote device,
   * via the device's `getGitWorkingTreePatches` RPC. Powers the web/remote Review
   * panel's unstaged diff. Returns `null` when offline / not a git repo.
   */
  getGitWorkingTreePatches: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitWorkingTreePatches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  /**
   * Branch diff (current branch vs base ref) per-file patches for a directory on
   * a remote device, via the device's `getGitBranchDiff` RPC.
   */
  getGitBranchDiff: deviceProcedure
    .input(z.object({ baseRef: z.string().optional(), deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitBranchDiff({
        baseRef: input.baseRef,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  /**
   * List the remote branches of a directory on a remote device, via the device's
   * `listGitRemoteBranches` RPC. Populates the Review base-ref picker.
   */
  listGitRemoteBranches: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitRemoteBranches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? [];
    }),

  /**
   * Repo-relative paths of dirty working-tree files for a directory on a remote
   * device, via the device's `getGitWorkingTreeFiles` RPC. Powers the Files tab's
   * git-status overlay. Returns `null` when offline / not a git repo.
   */
  getGitWorkingTreeFiles: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitWorkingTreeFiles({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  /**
   * Project file index (tree) for a directory on a remote device, via the
   * device's `getProjectFileIndex` RPC. Powers the Files tab's tree. Returns
   * `null` when offline.
   */
  getProjectFileIndex: deviceProcedure
    .input(z.object({ deviceId: z.string(), scope: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getProjectFileIndex({
        deviceId: input.deviceId,
        scope: input.scope,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  /**
   * Search project files on a remote device. The device performs the match and
   * returns only the result subtree needed by the UI.
   */
  searchProjectFiles: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        limit: z.number().int().positive().max(500).optional(),
        query: z.string(),
        scope: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.searchProjectFiles({
        deviceId: input.deviceId,
        limit: input.limit,
        query: input.query,
        scope: input.scope,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  /**
   * Read-only local file preview for a file on a remote device. The web client
   * receives render data, not a `localfile://` URL; saving remains unsupported.
   */
  getLocalFilePreview: workspaceFileProcedure
    .input(
      z.object({
        accept: z.enum(['image']).optional(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return deviceGateway.getLocalFilePreview({
        accept: input.accept,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),

  /**
   * Project skills (`.agents/skills` / `.claude/skills`) for a directory on a
   * remote device, via the device's `listProjectSkills` RPC. Powers the
   * Resources tab's skills group in device mode. Returns `null` when offline.
   */
  listProjectSkills: deviceProcedure
    .input(z.object({ deviceId: z.string(), scope: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listProjectSkills({
        deviceId: input.deviceId,
        scope: input.scope,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  /**
   * Revert a single file in a directory on a remote device, via the device's
   * `revertGitFile` RPC.
   */
  revertGitFile: deviceProcedure
    .input(z.object({ deviceId: z.string(), filePath: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.revertGitFile({
        deviceId: input.deviceId,
        filePath: input.filePath,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),

  /**
   * Move files/folders within a directory on a remote device, via the device's
   * `moveLocalFiles` RPC. Powers the Files tree's drag-to-move in device mode.
   */
  moveProjectFiles: workspaceFileProcedure
    .input(
      z.object({
        items: z.array(z.object({ newPath: z.string(), oldPath: z.string() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.moveProjectFiles({
        deviceId: input.deviceId,
        items: input.items,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),

  /**
   * Rename a single file/folder in a directory on a remote device, via the
   * device's `renameLocalFile` RPC.
   */
  renameProjectFile: workspaceFileProcedure
    .input(
      z.object({
        newName: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.renameProjectFile({
        deviceId: input.deviceId,
        newName: input.newName,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),

  /**
   * Save edited content back to a file on a remote device, via the device's
   * `writeLocalFile` RPC. Powers remote save in the LocalFile editor.
   */
  writeProjectFile: workspaceFileProcedure
    .input(
      z.object({
        content: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.writeProjectFile({
        content: input.content,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),

  /**
   * Check whether a path exists on a remote device and is a directory, via the
   * device's `statPath` RPC. Lets a web client validate a manually-entered
   * working directory before binding it. Returns `null` when the device is
   * unreachable (caller treats "can't verify" as non-blocking).
   */
  statPath: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.statPath({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  /**
   * Fetch the agent profile (title, description, avatar) from the platform
   * installed on the given device. Used to pre-fill the creation modal.
   * Returns an empty object on failure or when the platform has no profile.
   */
  getAgentProfile: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        platform: remotePlatformEnum,
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.executeToolCall(
        { deviceId: input.deviceId, userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          apiName: 'getAgentProfile',
          arguments: JSON.stringify({ platform: input.platform }),
          identifier: 'local',
        },
        PROFILE_TIMEOUT_MS,
      );

      if (!result.success) return {};

      try {
        return JSON.parse(result.content) as {
          avatar?: string;
          description?: string;
          title?: string;
        };
      } catch {
        return {};
      }
    }),

  getDeviceSystemInfo: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      return deviceGateway.queryDeviceSystemInfo(ctx.userId, input.deviceId, ctx.workspaceId);
    }),

  /**
   * All devices the user has ever registered (incl. offline). A device is keyed
   * by its `deviceId`; the gateway's live WS sessions are NOT separate devices —
   * each session is surfaced as a `channel` nested under its device. A single
   * device may therefore hold multiple channels (e.g. desktop app + CLI both
   * connected at once), and `online` is simply "has at least one live channel".
   *
   * A union, not just the DB rows: a device may be connected but not yet in
   * the DB (old client that predates auto-register, or registration still in
   * flight). Those are surfaced as transient entries so the picker never loses
   * a currently-reachable device during rollout.
   */
  listDevices: deviceProcedure.query(async ({ ctx }): Promise<DeviceListItem[]> => {
    const wsId = ctx.workspaceId;

    // Personal devices resolve under the user principal; workspace devices under
    // the `workspace:<id>` principal (a separate gateway pool). Fetch both.
    // `hiddenWorkspaceIds` (other members' private enrollments) is needed because
    // the gateway pool is visibility-blind: without it a private device would
    // resurface below as an online "ghost".
    const [
      personalRows,
      workspaceRows,
      hiddenWorkspaceIds,
      sharedRows,
      personalOnline,
      workspaceOnline,
    ] = await Promise.all([
      ctx.deviceModel.queryPersonal(),
      wsId ? ctx.deviceModel.queryWorkspaceDevices() : Promise.resolve([]),
      wsId ? ctx.deviceModel.queryWorkspaceHiddenDeviceIds() : Promise.resolve([]),
      ctx.deviceModel.querySharedWorkspaceDevices(),
      deviceGateway.queryDeviceList(ctx.userId),
      wsId ? deviceGateway.queryDeviceList(ctx.userId, wsId) : Promise.resolve([]),
    ]);

    // Shares the caller created from their personal device list, grouped by the
    // source personal deviceId — attached to personal rows below so the list can
    // render "shared to N workspaces" and revoke individual shares.
    const sharesByPersonalId = new Map<string, DeviceWorkspaceShare[]>();
    for (const s of sharedRows) {
      if (!s.sharedFromDeviceId || !s.workspaceId) continue;
      const list = sharesByPersonalId.get(s.sharedFromDeviceId) ?? [];
      list.push({
        deviceId: s.deviceId,
        visibility: s.visibility,
        workspaceId: s.workspaceId,
        workspaceName: s.workspaceName ?? null,
      });
      sharesByPersonalId.set(s.sharedFromDeviceId, list);
    }

    // Resolve display info for every enroller in a single roundtrip, so each
    // row can ship a self-contained `enroller` for the picker / settings UI.
    // Personal rows always belong to the caller, but the same lookup keeps the
    // shape uniform across scopes.
    const enrollerIds = [...new Set([...personalRows, ...workspaceRows].map((d) => d.userId))];
    const enrollerRows = enrollerIds.length
      ? await UserModel.findByIds(ctx.serverDB, enrollerIds)
      : [];
    const enrollerById = new Map(
      enrollerRows.map((u) => [
        u.id,
        {
          avatar: u.avatar ?? null,
          fullName: u.fullName ?? null,
          userId: u.id,
          username: u.username ?? null,
        },
      ]),
    );

    // The gateway already groups by device, exposing live sessions as nested
    // `channels`. Flatten one connection into the UI-facing channel shape; fall
    // back to a single synthetic channel for a legacy gateway that omits the field.
    const toChannels = (conn: DeviceAttachment): DeviceChannel[] =>
      conn.channels && conn.channels.length > 0
        ? conn.channels.map((c) => ({
            channel: c.channel ?? null,
            connectedAt: c.connectedAt,
            hostname: conn.hostname ?? null,
            platform: conn.platform ?? null,
          }))
        : [
            {
              channel: null,
              connectedAt: conn.lastSeen,
              hostname: conn.hostname ?? null,
              platform: conn.platform ?? null,
            },
          ];

    // Merge a DB-registered set with its live gateway pool into the UI shape.
    // `scope` tags the group; deviceIds never collide across pools (a personal id
    // is derived from userId, a workspace id from workspaceId).
    const buildItems = (
      rows: Awaited<ReturnType<typeof ctx.deviceModel.queryPersonal>>,
      onlineList: DeviceAttachment[],
      scope: DeviceScope,
      hiddenIds: string[] = [],
    ): DeviceListItem[] => {
      const hidden = new Set(hiddenIds);
      const channelsByDevice = new Map<string, DeviceChannel[]>();
      for (const conn of onlineList) {
        // Another member's private device: online in the workspace gateway pool
        // but not visible to the caller — must not leak as a ghost row.
        if (hidden.has(conn.deviceId)) continue;
        channelsByDevice.set(conn.deviceId, toChannels(conn));
      }

      const seen = new Set<string>();
      const fromDb = rows.map((d): DeviceListItem => {
        seen.add(d.deviceId);
        const channels = channelsByDevice.get(d.deviceId) ?? [];
        const live = channels[0];
        return {
          channels,
          defaultCwd: d.defaultCwd,
          deviceId: d.deviceId,
          // For personal rows this is always the caller; for workspace rows it
          // is the first enroller, surfaced so the UI can gate writes to "self
          // or workspace owner" and render the enroller's avatar without a
          // separate fetch. Falls back to a userId-only stub if the user row
          // was deleted (cascade nullifies devices.userId? no — FK is set, so
          // a stub keeps the gate fail-closed).
          enroller: enrollerById.get(d.userId) ?? {
            avatar: null,
            fullName: null,
            userId: d.userId,
            username: null,
          },
          friendlyName: d.friendlyName,
          hostname: d.hostname ?? live?.hostname ?? null,
          identitySource: d.identitySource,
          lastSeen: d.lastSeenAt.toISOString(),
          online: channels.length > 0,
          platform: d.platform ?? live?.platform ?? null,
          registered: true,
          scope,
          // Workspace rows only: member-shared (via the personal share flow)
          // vs directly enrolled — drives the "Shared by {name}" tag.
          sharedFromPersonal: scope === 'workspace' ? !!d.sharedFromDeviceId : undefined,
          // Personal rows only: the workspaces this machine was shared into
          // from the personal list (undefined for workspace rows and machines
          // never shared).
          sharedWorkspaces: scope === 'personal' ? sharesByPersonalId.get(d.deviceId) : undefined,
          // Personal rows have no workspace-visibility dimension; the column's
          // default is meaningless there, so normalise to null.
          visibility: scope === 'workspace' ? d.visibility : null,
          // Strip the heavy `workspace` scan (AGENTS.md + project skills, up to
          // ~30KB per dir) from the list payload. It's a server-owned cache for
          // the agent runtime (restored from the DB row on run start, never from
          // this response) and no client UI renders it from the list — skills are
          // re-derived live via `device.listProjectSkills`. Keep `workspaceScannedAt`
          // (a cheap number) so clients can still show scan freshness.
          workingDirs: (d.workingDirs ?? []).map(({ workspace: _workspace, ...rest }) => rest),
        };
      });

      // Online but not yet persisted — transient until the client auto-registers.
      const ghosts = [...channelsByDevice.entries()]
        .filter(([deviceId]) => !seen.has(deviceId))
        .map(([deviceId, channels]): DeviceListItem => ({
          channels,
          defaultCwd: null,
          deviceId,
          // No row yet → no enroller; UI gates treat this as not-editable.
          enroller: null,
          friendlyName: null,
          hostname: channels[0]?.hostname ?? null,
          identitySource: null,
          lastSeen: channels[0]?.connectedAt ?? new Date().toISOString(),
          online: true,
          platform: channels[0]?.platform ?? null,
          registered: false,
          scope,
          visibility: null,
          workingDirs: [] as WorkingDirEntry[],
        }));

      return [...fromDb, ...ghosts];
    };

    // Ordered here rather than in SQL: `online` is the primary key and only the
    // gateway knows it, so no per-pool `ORDER BY` can produce it — the two pools
    // and their ghosts have to be merged first, then ordered as one list.
    // Consumers (settings list, picker) filter this down to a single scope, and
    // filtering preserves order, so one pass serves every surface.
    return sortDevicesByActivity([
      ...buildItems(personalRows, personalOnline, 'personal'),
      ...buildItems(workspaceRows, workspaceOnline, 'workspace', hiddenWorkspaceIds),
    ]);
  }),

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
        deviceId: z.string().min(1).max(64),
        hostname: z.string().nullish(),
        identitySource: z.enum(['machine-id', 'fallback']),
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
   *   - nobody else may touch visibility (LOBE-11760): owners demoting another
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
   * Rename / set working dirs of a WORKSPACE device. Scoped by `workspace_id`
   * and gated by {@link canEditWorkspaceDevice}: owners may edit any device in
   * the pool; members may edit only devices they enrolled themselves. Mirrors
   * {@link deviceRouter.updateDevice} but for the workspace pool.
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
      if (!canEditWorkspaceDevice(role, ctx.userId, row.userId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the enrolling member or a workspace owner can modify this device.',
        });
      }
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

  /**
   * Auto-register the calling device (desktop after OIDC login / CLI on first
   * `lh connect`). Upserts on (userId, deviceId); user-owned fields are
   * preserved on conflict.
   */
  register: deviceProcedure
    .input(
      z.object({
        deviceId: z.string().min(1).max(64),
        hostname: z.string().nullish(),
        identitySource: z.enum(['machine-id', 'fallback']),
        platform: z.string().max(20).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.deviceModel.register(input);
    }),

  removeDevice: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.deviceModel.delete(input.deviceId);
      return { success: true };
    }),

  status: deviceProcedure.query(async ({ ctx }) => {
    return deviceGateway.queryDeviceStatus(ctx.userId, ctx.workspaceId);
  }),

  /** User-editable fields only — never the machine-reported identity columns. */
  updateDevice: deviceProcedure
    .input(
      z.object({
        defaultCwd: z.string().nullish(),
        deviceId: z.string(),
        friendlyName: z.string().max(100).nullish(),
        workingDirs: z.array(workingDirConfigSchema).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { deviceId, workingDirs, ...value } = input;

      // The workspace-init cache (workspace / workspaceScannedAt) is stripped
      // from `workingDirs` by the strict schema above, so re-attach it from the
      // stored row by path — otherwise an ordinary cwd save wipes the cache.
      const nextWorkingDirs = workingDirs
        ? preserveWorkspaceCache(
            workingDirs,
            (await ctx.deviceModel.findByDeviceId(deviceId))?.workingDirs ?? [],
          )
        : undefined;

      await ctx.deviceModel.update(deviceId, { ...value, workingDirs: nextWorkingDirs });
      return { success: true };
    }),
});
