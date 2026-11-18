import type { LobeChatDatabase } from '@lobechat/database';
import type { AgentAvailability, ManagedDevicePhase } from '@lobechat/types';
import debug from 'debug';
import { and, count, eq, inArray } from 'drizzle-orm';
import pMap from 'p-map';

import { agentDispatchPolicy } from '@/business/server/agentDispatchPolicy';
import { managedDeviceProvider } from '@/business/server/managedDevice';
import {
  AgentAccountBindingModel,
  AgentDeviceAccountBindingModel,
} from '@/database/models/agentQuota';
import { DeviceModel } from '@/database/models/device';
import { channelJobs, channelMembers } from '@/database/schemas';
import { loadAgentDeviceBindings } from '@/server/routers/lambda/deviceBoundAgents';
import { AgentQuotaService } from '@/server/services/agentQuota';
import { resolveDeviceRowId } from '@/server/services/agentQuota/resolveDeviceRowId';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';
import { redisService } from '@/server/services/redis';
import type {
  CachedAccountLoad,
  CachedDevicePresence,
} from '@/server/services/redis/agentAvailability';

import { type AvailabilityAccountLoad, resolveAgentAvailability } from './resolve';

const log = debug('lobe-server:agent-availability');

/** How long a status read waits for managed device phases; past it they read as unknown. */
const MANAGED_PHASES_TIMEOUT_MS = 3000;

const withTimeout = async <T>(work: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Whether Agents can take work right now, for one caller. The one place that combines device
 * presence, managed device phases, quota and queued work: Channel routing and the contact card
 * both read it, so what a card shows is what dispatch decides on.
 *
 * Device presence and quota loads are served from Redis (`redisService.agentAvailability`), one
 * key per device in the caller's pool and one per account; a miss does the live read and
 * remembers it. Queued work is read from the database every time: it moves with each dispatch.
 */
export class AgentAvailabilityService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /** Availability of each agent the caller can see; others are absent. */
  getAvailability = async (
    agentIds: string[],
    now: number = Date.now(),
  ): Promise<Record<string, AgentAvailability>> => {
    const ids = [...new Set(agentIds)];
    if (ids.length === 0) return {};

    const deviceByAgent = await loadAgentDeviceBindings({
      agentIds: ids,
      db: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    const [devices, accountsByAgent, activeJobs] = await Promise.all([
      this.readDevices([...new Set(Object.values(deviceByAgent))]),
      this.readAgentAccounts(ids, deviceByAgent),
      this.countActiveJobs(ids),
    ]);
    const loads = await this.readAccountLoads(
      [...new Set([...accountsByAgent.values()].flat())],
      now,
    );

    const result: Record<string, AgentAvailability> = {};
    for (const agentId of ids) {
      const deviceId = deviceByAgent[agentId];
      const availability = resolveAgentAvailability({
        activeJobs: activeJobs.get(agentId) ?? 0,
        device: deviceId ? devices.get(deviceId) : undefined,
        deviceId,
        loads: (accountsByAgent.get(agentId) ?? []).flatMap((id) => loads.get(id) ?? []),
        now,
      });
      result[agentId] = {
        ...availability,
        dispatchable: agentDispatchPolicy.canTakeUnaddressed(availability),
      };
    }
    return result;
  };

  /** The principal pool a device's presence is read in: the workspace, or the caller's own. */
  private get pool() {
    return this.workspaceId ? `ws:${this.workspaceId}` : `user:${this.userId}`;
  }

  private readDevices = async (deviceIds: string[]) => {
    const presence = new Map<string, CachedDevicePresence>();
    if (deviceIds.length === 0) return presence;

    const cached = await redisService.agentAvailability.readDevices(this.pool, deviceIds);
    deviceIds.forEach((deviceId, i) => {
      if (cached[i]) presence.set(deviceId, cached[i]);
    });
    if (presence.size === deviceIds.length) return presence;

    // One miss reads the whole pool: the gateway and the provider answer per pool anyway, and
    // remembering every device spares the next caller.
    const [pool, phases] = await Promise.all([
      getScopedOnlineDevices(this.db, this.userId, this.workspaceId).catch((error) => {
        log('device pool read failed: %O', error);
        return [];
      }),
      this.readManagedPhases(),
    ]);
    const live = new Map<string, CachedDevicePresence>();
    for (const device of pool)
      live.set(device.deviceId, { managedPhase: phases[device.deviceId], online: device.online });
    for (const [deviceId, managedPhase] of Object.entries(phases))
      if (!live.has(deviceId)) live.set(deviceId, { managedPhase, online: false });

    void redisService.agentAvailability.rememberDevices(this.pool, live);
    for (const deviceId of deviceIds) {
      const value = live.get(deviceId);
      if (value && !presence.has(deviceId)) presence.set(deviceId, value);
    }
    return presence;
  };

  private readManagedPhases = async (): Promise<Record<string, ManagedDevicePhase>> => {
    if (!(await managedDeviceProvider.isAvailable().catch(() => false))) return {};
    return withTimeout(
      managedDeviceProvider.listStates({ userId: this.userId, workspaceId: this.workspaceId }),
      MANAGED_PHASES_TIMEOUT_MS,
      {},
    );
  };

  /**
   * The accounts each agent can run on: the one pinned on its device when there is one (the
   * rest of its pool, logged in on other machines, cannot keep it on duty there), otherwise
   * every enabled account bound to it.
   */
  private readAgentAccounts = async (
    agentIds: string[],
    deviceByAgent: Record<string, string>,
  ): Promise<Map<string, string[]>> => {
    const bindings = new AgentAccountBindingModel(this.db, this.userId, this.workspaceId);
    const deviceBindings = new AgentDeviceAccountBindingModel(
      this.db,
      this.userId,
      this.workspaceId,
    );
    const deviceModel = new DeviceModel(this.db, this.userId, this.workspaceId);
    const rowIds = new Map<string, Promise<string | undefined>>();
    const rowIdOf = (deviceId: string) => {
      let id = rowIds.get(deviceId);
      if (!id) {
        id = resolveDeviceRowId(deviceModel, this.workspaceId, deviceId);
        rowIds.set(deviceId, id);
      }
      return id;
    };

    const entries = await pMap(
      agentIds,
      async (agentId): Promise<[string, string[]]> => {
        const deviceId = deviceByAgent[agentId];
        if (deviceId) {
          const rowId = await rowIdOf(deviceId);
          const pinned = rowId && (await deviceBindings.find(agentId, rowId))?.accountId;
          if (pinned) return [agentId, [pinned]];
        }
        const rows = await bindings.listByAgent(agentId);
        return [
          agentId,
          rows.filter((row) => row.enabled && row.role !== 'disabled').map((row) => row.accountId),
        ];
      },
      { concurrency: 5 },
    );
    return new Map(entries);
  };

  private readAccountLoads = async (accountIds: string[], now: number) => {
    const loads = new Map<string, AvailabilityAccountLoad>();
    if (accountIds.length === 0) return loads;

    const cached = await redisService.agentAvailability.readAccounts(accountIds);
    const missing: string[] = [];
    accountIds.forEach((accountId, i) => {
      if (cached[i]) loads.set(accountId, cached[i]);
      else missing.push(accountId);
    });
    if (missing.length === 0) return loads;

    const live = new Map<string, CachedAccountLoad>();
    const views = await new AgentQuotaService(this.db, this.userId, this.workspaceId)
      .resolveAccountLoads(missing, now)
      .catch((error) => {
        // Quota is a nice-to-have: a failed read only means "off duty" was not ruled in.
        log('quota load read failed: %O', error);
        return [];
      });
    for (const view of views)
      live.set(view.accountId, {
        enabled: view.enabled,
        rateLimitedUntil: view.rateLimitedUntil,
        sessionUtil: view.sessionUtil,
        weeklyUtil: view.weeklyUtil,
      });

    void redisService.agentAvailability.rememberAccounts(live, now);
    for (const [accountId, load] of live) loads.set(accountId, load);
    return loads;
  };

  /** Channel replies each agent has queued or running, across every Channel. */
  private countActiveJobs = async (agentIds: string[]) => {
    const rows = await this.db
      .select({ agentId: channelMembers.agentId, value: count() })
      .from(channelJobs)
      .innerJoin(channelMembers, eq(channelMembers.id, channelJobs.memberId))
      .where(
        and(
          inArray(channelMembers.agentId, agentIds),
          inArray(channelJobs.status, ['queued', 'running']),
        ),
      )
      .groupBy(channelMembers.agentId);
    return new Map(rows.flatMap((row) => (row.agentId ? [[row.agentId, row.value]] : [])));
  };
}
