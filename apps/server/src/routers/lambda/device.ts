import { REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
import type { DeviceChannel, DeviceListItem, WorkingDirEntry } from '@lobechat/types';
import { z } from 'zod';

import { DeviceModel } from '@/database/models/device';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { deviceGateway } from '@/server/services/deviceGateway';

import { preserveWorkspaceCache } from './deviceWorkingDirs';

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

const deviceProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { deviceModel: new DeviceModel(ctx.serverDB, ctx.userId), userId: ctx.userId },
  });
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
        { deviceId: input.deviceId, userId: ctx.userId },
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
      });
      return result ?? null;
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
      });
      return result ?? null;
    }),

  /**
   * Read-only local file preview for a file on a remote device. The web client
   * receives render data, not a `localfile://` URL; saving remains unsupported.
   */
  getLocalFilePreview: deviceProcedure
    .input(
      z.object({
        accept: z.enum(['image']).optional(),
        deviceId: z.string(),
        path: z.string(),
        workingDirectory: z.string(),
      }),
    )
    .query(async ({ ctx, input }) =>
      deviceGateway.getLocalFilePreview({
        accept: input.accept,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workingDirectory: input.workingDirectory,
      }),
    ),

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
      }),
    ),

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
        { deviceId: input.deviceId, userId: ctx.userId },
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
      return deviceGateway.queryDeviceSystemInfo(ctx.userId, input.deviceId);
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
    const [registered, onlineList] = await Promise.all([
      ctx.deviceModel.query(),
      deviceGateway.queryDeviceList(ctx.userId),
    ]);

    // The gateway already groups by device, exposing live sessions as nested
    // `channels`. Flatten them into the UI-facing channel shape; fall back to a
    // single synthetic channel for a legacy gateway that omits the field.
    const channelsByDevice = new Map<string, DeviceChannel[]>();
    for (const conn of onlineList) {
      const channels: DeviceChannel[] =
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
      channelsByDevice.set(conn.deviceId, channels);
    }

    const seen = new Set<string>();

    const fromDb = registered.map((d) => {
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
        workingDirs: d.workingDirs ?? [],
      };
    });

    // Online but not yet persisted — transient until the client auto-registers.
    const ghosts = [...channelsByDevice.entries()]
      .filter(([deviceId]) => !seen.has(deviceId))
      .map(([deviceId, channels]) => ({
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
        workingDirs: [] as WorkingDirEntry[],
      }));

    return [...fromDb, ...ghosts];
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
    return deviceGateway.queryDeviceStatus(ctx.userId);
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
