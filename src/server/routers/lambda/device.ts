import { REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
import { z } from 'zod';

import { DeviceModel } from '@/database/models/device';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { deviceProxy } from '@/server/services/toolExecution/deviceProxy';

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
      const result = await deviceProxy.executeToolCall(
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
      const result = await deviceProxy.executeToolCall(
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
      return deviceProxy.queryDeviceSystemInfo(ctx.userId, input.deviceId);
    }),

  /**
   * All devices the user has ever registered (incl. offline), each enriched
   * with a live `online` flag from the gateway's in-memory WS sessions.
   *
   * A union, not just the DB rows: a device may be connected but not yet in
   * the DB (old client that predates auto-register, or registration still in
   * flight). Those are surfaced as transient entries so the picker never loses
   * a currently-reachable device during rollout.
   */
  listDevices: deviceProcedure.query(async ({ ctx }) => {
    const [registered, onlineList] = await Promise.all([
      ctx.deviceModel.query(),
      deviceProxy.queryDeviceList(ctx.userId),
    ]);

    const onlineMap = new Map(onlineList.map((d) => [d.deviceId, d]));
    const seen = new Set<string>();

    const fromDb = registered.map((d) => {
      seen.add(d.deviceId);
      const live = onlineMap.get(d.deviceId);
      return {
        defaultCwd: d.defaultCwd,
        deviceId: d.deviceId,
        friendlyName: d.friendlyName,
        hostname: d.hostname ?? live?.hostname ?? null,
        identitySource: d.identitySource,
        lastSeen: d.lastSeenAt.toISOString(),
        online: onlineMap.has(d.deviceId),
        platform: d.platform ?? live?.platform ?? null,
        recentCwds: d.recentCwds,
        registered: true,
      };
    });

    // Online but not yet persisted — transient until the client auto-registers.
    const ghosts = onlineList
      .filter((d) => !seen.has(d.deviceId))
      .map((d) => ({
        defaultCwd: null,
        deviceId: d.deviceId,
        friendlyName: null,
        hostname: d.hostname ?? null,
        identitySource: null,
        lastSeen: d.lastSeen,
        online: true,
        platform: d.platform ?? null,
        recentCwds: [] as string[],
        registered: false,
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
    return deviceProxy.queryDeviceStatus(ctx.userId);
  }),

  /** User-editable fields only — never the machine-reported identity columns. */
  updateDevice: deviceProcedure
    .input(
      z.object({
        defaultCwd: z.string().nullable().optional(),
        deviceId: z.string(),
        friendlyName: z.string().max(100).nullable().optional(),
        recentCwds: z.array(z.string()).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { deviceId, ...value } = input;
      await ctx.deviceModel.update(deviceId, value);
      return { success: true };
    }),
});
