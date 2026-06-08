import type { WorkingDirEntry } from '@lobechat/database/schemas';
import { REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
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

/** A single live gateway WebSocket connection belonging to a device. */
interface DeviceChannel {
  channel: string | null;
  connectedAt: string;
  hostname: string | null;
  platform: string | null;
}

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
   * Git status (branch / file changes / linked PR) for a directory on a remote
   * device, fetched via the device's `gitInfo` RPC. Lets the UI render a remote
   * device's git the same as the local desktop. Returns `null` when offline /
   * the directory isn't a git repo.
   */
  gitInfo: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        isGithub: z.boolean().optional(),
        scope: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitInfo(
        ctx.userId,
        input.deviceId,
        input.scope,
        input.isGithub,
      );
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
  listDevices: deviceProcedure.query(async ({ ctx }) => {
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
