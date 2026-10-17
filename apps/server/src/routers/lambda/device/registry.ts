import type {
  DeviceChannel,
  DeviceEnroller,
  DeviceListItem,
  DeviceRunningSummary,
  DeviceScope,
  DeviceWorkspaceShare,
  WorkingDirEntry,
} from '@lobechat/types';
import { sortDevicesByActivity, workingDirConfigSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getTopicDeviceId, TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { type DeviceAttachment, deviceGateway } from '@/server/services/deviceGateway';
import { filterAuthorizedDevicePresence } from '@/server/services/deviceGateway/scopedDevicePresence';

import { loadDeviceBoundAgents } from '../deviceBoundAgents';
import { preserveWorkspaceCache } from '../deviceWorkingDirs';
import { deviceProcedure } from './procedures';

/**
 * Display info for the members behind a set of running topics. The ids come
 * from topic rows the caller was already allowed to read, so this only adds
 * the public-facing name and avatar.
 */
const loadTopicUsers = async (
  db: Parameters<typeof UserModel.getDisplayInfoByIds>[0],
  userIds: string[],
): Promise<Map<string, DeviceEnroller>> => {
  const rows = await UserModel.getDisplayInfoByIds(db, [...new Set(userIds)]);
  return new Map(
    rows.map((u) => [
      u.id,
      { avatar: u.avatar, fullName: u.fullName, userId: u.id, username: u.username },
    ]),
  );
};

/**
 * The member running each topic now: the initiator of its current run, else
 * its creator (a client-executed run writes no operation row). In a workspace
 * a teammate can continue someone else's topic, so the creator alone would
 * name the wrong person as using the device.
 */
const resolveRunUserIds = async (
  topicModel: TopicModel,
  topics: { id: string; userId: string }[],
): Promise<Map<string, string>> => {
  const initiators = await topicModel.findRunInitiators(topics.map((topic) => topic.id));
  return new Map(topics.map((topic) => [topic.id, initiators.get(topic.id) ?? topic.userId]));
};

/**
 * Upper bound on the running topics read for the device-list summary. A real
 * account runs far fewer at once; the cap only bounds a pathological one.
 */
const RUNNING_SUMMARY_LIMIT = 500;

export const registryProcedures = {
  /**
   * What the device is doing for the caller: topics running on it right now
   * and the agents routed to it. Both reads go through the regular content
   * scopes, so in a workspace a teammate's private agent (and the topics under
   * it) never surface just because they share the machine.
   *
   * Agent bindings are resolved per caller: the stored agency config merged
   * with the caller's own per-agent device override in this workspace, exactly
   * as a run would route — see {@link loadDeviceBoundAgents}.
   */
  getDeviceActivity: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const [agents, runningTopics] = await Promise.all([
        loadDeviceBoundAgents({
          db: ctx.serverDB,
          deviceId: input.deviceId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
        topicModel.queryTopics({ deviceId: input.deviceId, statuses: ['running'] }),
      ]);

      const runUserIds = await resolveRunUserIds(topicModel, runningTopics);
      const users = await loadTopicUsers(ctx.serverDB, [...runUserIds.values()]);

      return {
        agents,
        runningTopics: runningTopics.map((topic) => ({
          ...topic,
          user: users.get(runUserIds.get(topic.id) ?? topic.userId) ?? null,
        })),
      };
    }),
  /**
   * Per-device running-topic counts and the members behind them, for the
   * device list cards. One read for the whole list instead of a request per
   * card; the same content scopes as {@link getDeviceActivity} apply, and a
   * device the caller cannot see simply has no card to render its entry.
   */
  getRunningSummary: deviceProcedure.query(async ({ ctx }): Promise<DeviceRunningSummary[]> => {
    // Most recently active first, so each device's avatar stack leads with
    // whoever touched it last.
    const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const runningTopics = (
      await topicModel.queryTopics({ pageSize: RUNNING_SUMMARY_LIMIT, statuses: ['running'] })
    ).filter((topic) => getTopicDeviceId(topic.metadata));
    const runUserIds = await resolveRunUserIds(topicModel, runningTopics);

    const byDevice = new Map<string, { count: number; userIds: string[] }>();
    for (const topic of runningTopics) {
      const deviceId = getTopicDeviceId(topic.metadata)!;
      const runUserId = runUserIds.get(topic.id) ?? topic.userId;
      const entry = byDevice.get(deviceId) ?? { count: 0, userIds: [] };
      entry.count += 1;
      if (!entry.userIds.includes(runUserId)) entry.userIds.push(runUserId);
      byDevice.set(deviceId, entry);
    }

    const users = await loadTopicUsers(
      ctx.serverDB,
      [...byDevice.values()].flatMap((entry) => entry.userIds),
    );

    return [...byDevice].map(([deviceId, { count, userIds }]) => ({
      count,
      deviceId,
      users: userIds.flatMap((id) => users.get(id) ?? []),
    }));
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
   * Personal scope is a union rather than only DB rows: auto-registration may
   * briefly lag a live socket. Workspace scope fails closed on visible registry
   * rows because the row is the enrollment and authorization boundary.
   */
  listDevices: deviceProcedure.query(async ({ ctx }): Promise<DeviceListItem[]> => {
    const wsId = ctx.workspaceId;

    // Personal devices resolve under the user principal; workspace devices under
    // the `workspace:<id>` principal (a separate gateway pool). Fetch both.
    const [personalRows, workspaceRows, sharedRows, personalOnline, workspaceOnline] =
      await Promise.all([
        ctx.deviceModel.queryPersonal(),
        wsId ? ctx.deviceModel.queryWorkspaceDevices() : Promise.resolve([]),
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
    ): DeviceListItem[] => {
      const registeredDeviceIds = new Set(rows.map((device) => device.deviceId));
      const channelsByDevice = new Map<string, DeviceChannel[]>();
      for (const conn of filterAuthorizedDevicePresence(registeredDeviceIds, onlineList, scope)) {
        channelsByDevice.set(conn.deviceId, toChannels(conn));
      }

      const seen = new Set<string>();
      const fromDb = rows.map((d): DeviceListItem => {
        seen.add(d.deviceId);
        const channels = channelsByDevice.get(d.deviceId) ?? [];
        const live = channels[0];
        return {
          architecture: d.architecture,
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
          metadata: d.metadata,
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

      // Personal clients auto-register immediately before opening their
      // socket, so preserve their brief Gateway-first race. Workspace rows are
      // authorization: a Gateway-only socket may be a stale process that missed
      // Unshare, and must stay hidden and ineligible.
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
      ...buildItems(workspaceRows, workspaceOnline, 'workspace'),
    ]);
  }),

  // ─── Tunnel links ───
  //
  // A tunnel makes one loopback port on a device reachable at
  // `https://<port>--<slug>.lobe.sh/`. Creating one is gated exactly like
  // browsing the device's filesystem: on a public workspace device any
  // non-viewer member may expose a port; on a private one, only the enrolling
  // member or an owner.
  /**
   * Auto-register the calling device (desktop after OIDC login / CLI on first
   * `lh connect`). Upserts on (userId, deviceId); user-owned fields are
   * preserved on conflict.
   */
  register: deviceProcedure
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
  updateDeviceInfo: deviceProcedure
    .input(
      z.object({
        architecture: z.string().min(1).max(20).optional(),
        deviceId: z.string().min(1).max(64),
        hostname: z.string().optional(),
        metadata: z
          .record(z.string().max(64), z.string().max(200))
          .refine((m) => Object.keys(m).length <= 20, 'metadata supports at most 20 keys')
          .optional(),
        platform: z.string().max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { deviceId, ...value } = input;
      const device = await ctx.deviceModel.updateDeviceInfo(deviceId, value);
      if (!device) throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found' });
      return { success: true };
    }),
};
