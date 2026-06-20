import { REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
import type { DeviceChannel, DeviceListItem, DeviceScope, WorkingDirEntry } from '@lobechat/types';
import { z } from 'zod';

import {
  wsCompatProcedure,
  wsOwnerProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeviceModel } from '@/database/models/device';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signWorkspaceDeviceToken } from '@/libs/trpc/utils/internalJwt';
import { type DeviceAttachment, deviceGateway } from '@/server/services/deviceGateway';

import { preserveWorkspaceCache } from './deviceWorkingDirs';
import { assertWorkspaceRootApproved } from './deviceWorkspaceGuard';

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

// Workspace-aware (compat): with an `X-Workspace-Id` header the device list also
// surfaces the workspace's shared devices; without it, the personal path is
// unchanged (`ctx.workspaceId === undefined`).
const deviceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      deviceModel: new DeviceModel(ctx.serverDB, ctx.userId, wsId),
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
    .input(z.object({ branch: z.string(), deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitLinkedPullRequest({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
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
    const [personalRows, workspaceRows, personalOnline, workspaceOnline] = await Promise.all([
      ctx.deviceModel.queryPersonal(),
      wsId ? ctx.deviceModel.queryWorkspaceDevices() : Promise.resolve([]),
      deviceGateway.queryDeviceList(ctx.userId),
      wsId ? deviceGateway.queryDeviceList(ctx.userId, wsId) : Promise.resolve([]),
    ]);

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
    ): DeviceListItem[] => {
      const channelsByDevice = new Map<string, DeviceChannel[]>();
      for (const conn of onlineList) channelsByDevice.set(conn.deviceId, toChannels(conn));

      const seen = new Set<string>();
      const fromDb = rows.map((d): DeviceListItem => {
        seen.add(d.deviceId);
        const channels = channelsByDevice.get(d.deviceId) ?? [];
        const live = channels[0];
        return {
          channels,
          defaultCwd: d.defaultCwd,
          deviceId: d.deviceId,
          friendlyName: d.friendlyName,
          hostname: d.hostname ?? live?.hostname ?? null,
          identitySource: d.identitySource,
          lastSeen: d.lastSeenAt.toISOString(),
          online: channels.length > 0,
          platform: d.platform ?? live?.platform ?? null,
          registered: true,
          scope,
          workingDirs: d.workingDirs ?? [],
        };
      });

      // Online but not yet persisted — transient until the client auto-registers.
      const ghosts = [...channelsByDevice.entries()]
        .filter(([deviceId]) => !seen.has(deviceId))
        .map(
          ([deviceId, channels]): DeviceListItem => ({
            channels,
            defaultCwd: null,
            deviceId,
            friendlyName: null,
            hostname: channels[0]?.hostname ?? null,
            identitySource: null,
            lastSeen: channels[0]?.connectedAt ?? new Date().toISOString(),
            online: true,
            platform: channels[0]?.platform ?? null,
            registered: false,
            scope,
            workingDirs: [] as WorkingDirEntry[],
          }),
        );

      return [...fromDb, ...ghosts];
    };

    return [
      ...buildItems(personalRows, personalOnline, 'personal'),
      ...buildItems(workspaceRows, workspaceOnline, 'workspace'),
    ];
  }),

  /**
   * Mint a short-lived connect token for enrolling a WORKSPACE-owned device.
   * Owner-only (`wsOwnerProcedure`) — the server verifies the caller is an admin
   * of the workspace, then signs a token carrying the `workspace_id` claim that
   * the device gateway trusts to route the device to the `workspace:<id>`
   * principal. The CLI (`lh connect --workspace`) / settings page use this.
   */
  mintWorkspaceConnectToken: wsOwnerProcedure.mutation(async ({ ctx }) => {
    const token = await signWorkspaceDeviceToken(ctx.workspaceId);
    return { token, workspaceId: ctx.workspaceId };
  }),

  /**
   * Enroll the calling machine as a device of the current workspace. Owner-only;
   * stamps `workspace_id` so the row belongs to the workspace. Used by
   * `lh connect --workspace` after minting the connect token.
   */
  registerWorkspaceDevice: wsOwnerProcedure
    .use(serverDatabase)
    .input(
      z.object({
        deviceId: z.string().min(1).max(64),
        hostname: z.string().nullable().optional(),
        identitySource: z.enum(['machine-id', 'fallback']),
        platform: z.string().max(20).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      return model.registerWorkspaceDevice({ ...input, workspaceId: ctx.workspaceId });
    }),

  /**
   * Rename / set working dirs of a WORKSPACE device — scoped by `workspace_id`,
   * owner-gated, so any workspace owner can manage it (not just the enroller).
   * Mirrors {@link deviceRouter.updateDevice} but for the workspace pool.
   */
  updateWorkspaceDevice: wsOwnerProcedure
    .use(serverDatabase)
    .input(
      z.object({
        defaultCwd: z.string().nullable().optional(),
        deviceId: z.string(),
        friendlyName: z.string().max(100).nullable().optional(),
        workingDirs: z
          .array(z.object({ path: z.string(), repoType: z.enum(['git', 'github']).optional() }))
          .max(20)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const { deviceId, workingDirs, ...value } = input;
      const nextWorkingDirs = workingDirs
        ? preserveWorkspaceCache(
            workingDirs,
            (await model.findWorkspaceDeviceById(deviceId))?.workingDirs ?? [],
          )
        : undefined;
      await model.updateWorkspaceDevice(deviceId, { ...value, workingDirs: nextWorkingDirs });
      return { success: true };
    }),

  /** Remove a WORKSPACE device — scoped by `workspace_id`, owner-gated. */
  removeWorkspaceDevice: wsOwnerProcedure
    .use(serverDatabase)
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const model = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
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
        hostname: z.string().nullable().optional(),
        identitySource: z.enum(['machine-id', 'fallback']),
        platform: z.string().max(20).nullable().optional(),
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
        defaultCwd: z.string().nullable().optional(),
        deviceId: z.string(),
        friendlyName: z.string().max(100).nullable().optional(),
        workingDirs: z
          .array(z.object({ path: z.string(), repoType: z.enum(['git', 'github']).optional() }))
          .max(20)
          .optional(),
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
