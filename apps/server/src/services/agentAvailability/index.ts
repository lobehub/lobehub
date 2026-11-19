import type { LobeChatDatabase } from '@lobechat/database';
import { claudeCodeAgentEnvPicksLogin } from '@lobechat/heterogeneous-agents/quota';
import type { AgentAvailability, LobeAgentAgencyConfig, ManagedDevicePhase } from '@lobechat/types';
import debug from 'debug';
import { and, count, eq, inArray } from 'drizzle-orm';
import pMap from 'p-map';

import { agentDispatchPolicy } from '@/business/server/agentDispatchPolicy';
import { managedDeviceProvider } from '@/business/server/managedDevice';
import { AgentModel } from '@/database/models/agent';
import { DeviceModel } from '@/database/models/device';
import { channelJobs, channelMembers } from '@/database/schemas';
import { loadAgentDeviceBindings } from '@/server/routers/lambda/deviceBoundAgents';
import { AgentQuotaService } from '@/server/services/agentQuota';
import { resolveDeviceRowId } from '@/server/services/agentQuota/resolveDeviceRowId';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';
import { redisService } from '@/server/services/redis';
import type {
  CachedAgentQuota,
  CachedDevicePresence,
} from '@/server/services/redis/agentAvailability';

import { resolveAgentAvailability } from './resolve';

const log = debug('lobe-server:agent-availability');

/**
 * Whether a device run of this agent is routed through its bound accounts, as device dispatch
 * decides it (`resolveClaudeAccountRouting`): only Claude Code is, and not when the agent's env
 * picks its own login (an API key, a config dir). Any other agent is never judged by quota.
 */
const routesThroughQuota = (agencyConfig?: LobeAgentAgencyConfig | null) => {
  const provider = agencyConfig?.heterogeneousProvider;
  return provider?.type === 'claude-code' && !claudeCodeAgentEnvPicksLogin(provider.env);
};

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
    const requested = [...new Set(agentIds)];
    if (requested.length === 0) return {};

    // Only agents the caller can see: every read below trusts these ids.
    const visible = await new AgentModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).queryAgencyRoutingByIds(requested);
    const ids = visible.map((agent) => agent.id);
    if (ids.length === 0) return {};

    const deviceByAgent = await loadAgentDeviceBindings({
      agentIds: ids,
      db: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    const [devices, quotas, activeJobs] = await Promise.all([
      this.readDevices([...new Set(Object.values(deviceByAgent))]),
      this.readQuotas(
        // Account routing runs only for a run dispatched to a device; a Cloud Sandbox run uses
        // its own vault credential, so bindings kept from a device setup do not bench it.
        visible
          .filter((agent) => deviceByAgent[agent.id] && routesThroughQuota(agent.agencyConfig))
          .map((agent) => agent.id),
        deviceByAgent,
        now,
      ),
      this.countActiveJobs(ids),
    ]);

    const result: Record<string, AgentAvailability> = {};
    for (const agentId of ids) {
      const deviceId = deviceByAgent[agentId];
      const availability = resolveAgentAvailability({
        activeJobs: activeJobs.get(agentId) ?? 0,
        device: deviceId ? devices.get(deviceId) : undefined,
        deviceId,
        quota: quotas.get(agentId),
      });
      result[agentId] = {
        ...availability,
        dispatchable: agentDispatchPolicy.canTakeUnaddressed(availability),
      };
    }
    return result;
  };

  /**
   * The principal pool a device's presence is read in: the caller's own, or the caller within
   * the workspace. Per caller even in a workspace: the scoped device list leaves out another
   * member's private devices, so one member's view must never answer for another's.
   */
  private get pool() {
    return this.workspaceId ? `ws:${this.workspaceId}:user:${this.userId}` : `user:${this.userId}`;
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
   * Whether each agent would find quota where it runs, as `AgentQuotaService.resolveAgentAvailability`
   * judges it: on the accounts a run there is routed to (the device's choice, a strict legacy
   * pin, or the pool), and only those the caller can see. The answer is remembered per caller,
   * agent and device, so one member's view never answers for another's.
   */
  private readQuotas = async (
    agentIds: string[],
    deviceByAgent: Record<string, string>,
    now: number,
  ): Promise<Map<string, CachedAgentQuota>> => {
    const keyOf = (agentId: string) => ({ agentId, deviceId: deviceByAgent[agentId] });
    const cached = await redisService.agentAvailability.readQuotas(
      this.userId,
      this.pool,
      agentIds.map(keyOf),
    );
    const quotas = new Map<string, CachedAgentQuota>();
    const missing: string[] = [];
    agentIds.forEach((agentId, i) => {
      if (cached[i]) quotas.set(agentId, cached[i]);
      else missing.push(agentId);
    });
    if (missing.length === 0) return quotas;

    const quotaService = new AgentQuotaService(this.db, this.userId, this.workspaceId);
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

    const live = await pMap(
      missing,
      async (agentId): Promise<[string, CachedAgentQuota] | undefined> => {
        const deviceId = deviceByAgent[agentId];
        try {
          const quota = await quotaService.resolveAgentAvailability(agentId, {
            deviceId: deviceId ? await rowIdOf(deviceId) : undefined,
            now,
            provider: 'claude-code',
          });
          return [
            agentId,
            {
              exhausted: quota.status === 'exhausted',
              ...(quota.resetsAt !== undefined && { resetsAt: quota.resetsAt }),
            },
          ];
        } catch (error) {
          // Quota is a nice-to-have: a failed read only means "off duty" was not ruled in.
          log('quota read failed for %s: %O', agentId, error);
        }
      },
      { concurrency: 5 },
    );

    const fresh = live.filter((entry): entry is [string, CachedAgentQuota] => !!entry);
    void redisService.agentAvailability.rememberQuotas(
      this.userId,
      this.pool,
      fresh.map(([agentId, quota]) => ({ ...keyOf(agentId), quota })),
      now,
    );
    for (const [agentId, quota] of fresh) quotas.set(agentId, quota);
    return quotas;
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
