import type {
  DevicePoolDecision,
  DevicePoolMatrix,
  DevicePoolPolicy,
  DevicePoolRunContext,
  DevicePoolSubject,
} from '@lobechat/types';
import { devicePoolMatrixSchema, devicePoolPolicySchema } from '@lobechat/types';
import { createDevicePoolPolicy, evaluateDevicePoolUse } from '@lobechat/utils/devicePoolPolicy';
import { and, count, eq, getTableColumns, isNull, or } from 'drizzle-orm';

import {
  agentDevicePoolPolicies,
  agents,
  devicePoolDevices,
  devicePools,
  devices,
  users,
  workspaceMembers,
} from '../schemas';
import type { LobeChatDatabase } from '../type';

/** A scoped policy resource is missing or the caller cannot modify it. */
export class DevicePoolAccessError extends Error {}

/**
 * Persists device pools and evaluates access using fresh policy and membership data.
 *
 * Use when:
 * - Managing pool configuration or authorizing device discovery and dispatch
 *
 * Expects:
 * - userId is the authenticated storage principal, workspaceId is server-validated
 *
 * Returns:
 * - Scoped data and decisions; writes require ownership, never merely use permission
 */
export class DevicePoolModel {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  private scope = () =>
    this.workspaceId
      ? eq(devicePools.workspaceId, this.workspaceId)
      : and(isNull(devicePools.workspaceId), eq(devicePools.userId, this.userId));

  /** Checks current membership, including removal after operation creation. */
  private async isMember(userId: string) {
    if (!this.workspaceId) return false;
    const [row] = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, this.workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** Rejects named grants outside current workspace membership before they are persisted. */
  private async assertNamedMembers(rules: DevicePoolMatrix) {
    const ids = [
      ...new Set(
        Object.values(rules).flatMap((row) =>
          Object.keys(row ?? {})
            .filter((key) => key.startsWith('user:'))
            .map((key) => key.slice(5)),
        ),
      ),
    ];
    for (const id of ids) {
      if (!(await this.isMember(id)))
        throw new DevicePoolAccessError('User is outside the pool workspace');
    }
  }

  private async assertScope() {
    if (this.workspaceId && !(await this.isMember(this.userId)))
      throw new DevicePoolAccessError('Workspace membership required');
  }

  private async requirePool(id: string, manage = false) {
    await this.assertScope();
    const [pool] = await this.db
      .select()
      .from(devicePools)
      .where(and(eq(devicePools.id, id), this.scope()))
      .limit(1);
    if (!pool || (manage && pool.userId !== this.userId))
      throw new DevicePoolAccessError('Pool not found or policy editing is not permitted');
    return pool;
  }

  /** Lists readable pools with an explicit policy-management capability. */
  async list() {
    await this.assertScope();
    const pools = await this.db
      .select({
        ...getTableColumns(devicePools),
        deviceCount: count(devicePoolDevices.id),
      })
      .from(devicePools)
      .leftJoin(devicePoolDevices, eq(devicePoolDevices.poolId, devicePools.id))
      .where(this.scope())
      .groupBy(devicePools.id);
    const overrides = await this.db
      .select({ poolId: devicePools.id, agentId: agents.id })
      .from(agentDevicePoolPolicies)
      .innerJoin(devicePools, eq(agentDevicePoolPolicies.poolId, devicePools.id))
      .innerJoin(agents, eq(agentDevicePoolPolicies.agentId, agents.id))
      .where(
        and(
          this.scope(),
          this.workspaceId
            ? and(
                eq(agents.workspaceId, this.workspaceId),
                or(eq(agents.visibility, 'public'), eq(agents.userId, this.userId)),
              )
            : and(isNull(agents.workspaceId), eq(agents.userId, this.userId)),
        ),
      );
    return pools.map((pool) => ({
      ...pool,
      canManage: pool.userId === this.userId,
      overrideAgentIds: overrides
        .filter((override) => override.poolId === pool.id)
        .map((override) => override.agentId),
    }));
  }

  /** Creates a pool with owner-only Chat/Task use and default-denied Bot use. */
  async create(name: string) {
    await this.assertScope();
    const [pool] = await this.db
      .insert(devicePools)
      .values({
        name,
        policy: createDevicePoolPolicy(),
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .returning();
    return pool;
  }

  /** Reads pool configuration, device memberships, and Agent overrides in one scope. */
  async detail(id: string) {
    const pool = await this.requirePool(id);
    const [members, overrides, availableDevices] = await Promise.all([
      this.db
        .select({
          id: devices.id,
          deviceId: devices.deviceId,
          name: devices.friendlyName,
          hostname: devices.hostname,
          userId: devices.userId,
        })
        .from(devicePoolDevices)
        .innerJoin(devices, eq(devicePoolDevices.deviceId, devices.id))
        .where(eq(devicePoolDevices.poolId, id)),
      this.db
        .select({ agentId: agents.id, name: agents.title, rules: agentDevicePoolPolicies.rules })
        .from(agentDevicePoolPolicies)
        .innerJoin(agents, eq(agentDevicePoolPolicies.agentId, agents.id))
        .where(
          and(
            eq(agentDevicePoolPolicies.poolId, id),
            this.workspaceId
              ? and(
                  eq(agents.workspaceId, this.workspaceId),
                  or(eq(agents.visibility, 'public'), eq(agents.userId, this.userId)),
                )
              : and(isNull(agents.workspaceId), eq(agents.userId, this.userId)),
          ),
        ),
      this.db
        .select({ id: devices.id, name: devices.friendlyName, hostname: devices.hostname })
        .from(devices)
        .where(
          and(
            eq(devices.userId, this.userId),
            this.workspaceId
              ? eq(devices.workspaceId, this.workspaceId)
              : isNull(devices.workspaceId),
          ),
        ),
    ]);
    const availablePeople = this.workspaceId
      ? await this.db
          .select({
            id: users.id,
            name: users.fullName,
            username: users.username,
            avatar: users.avatar,
          })
          .from(workspaceMembers)
          .innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(
            and(
              eq(workspaceMembers.workspaceId, this.workspaceId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
      : [];
    return {
      ...pool,
      availablePeople,
      availableDevices,
      canManage: pool.userId === this.userId,
      devices: members,
      overrides,
    };
  }

  /** Updates supplied metadata or policy fields without overwriting independently saved settings. */
  async update(id: string, { name, policy }: { name?: string; policy?: DevicePoolPolicy }) {
    await this.requirePool(id, true);
    if (policy) await this.assertNamedMembers(policy.rules);
    await this.db
      .update(devicePools)
      .set({ name, policy, updatedAt: new Date() })
      .where(and(eq(devicePools.id, id), eq(devicePools.userId, this.userId), this.scope()));
  }

  /** Deletes a pool; managed devices do not regain legacy public permissions. */
  async remove(id: string) {
    await this.requirePool(id, true);
    await this.db
      .delete(devicePools)
      .where(and(eq(devicePools.id, id), eq(devicePools.userId, this.userId), this.scope()));
  }

  /** Adds the caller's own device, atomically recording that its authorization is pool-managed. */
  async addDevice(poolId: string, deviceId: string) {
    await this.requirePool(poolId);
    await this.db.transaction(async (tx) => {
      const [device] = await tx
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.id, deviceId),
            eq(devices.userId, this.userId),
            this.workspaceId
              ? eq(devices.workspaceId, this.workspaceId)
              : isNull(devices.workspaceId),
          ),
        )
        .for('update');
      if (!device)
        throw new DevicePoolAccessError('Only the device owner can authorize pool membership');
      await tx.update(devices).set({ poolManaged: true }).where(eq(devices.id, deviceId));
      await tx.insert(devicePoolDevices).values({ deviceId, poolId }).onConflictDoNothing();
    });
  }

  /** Revokes a membership as either the device owner or the pool creator. */
  async removeDevice(poolId: string, deviceId: string) {
    const pool = await this.requirePool(poolId);
    const [device] = await this.db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    if (!device || (device.userId !== this.userId && pool.userId !== this.userId))
      throw new DevicePoolAccessError('Device membership cannot be changed');
    await this.db
      .delete(devicePoolDevices)
      .where(and(eq(devicePoolDevices.poolId, poolId), eq(devicePoolDevices.deviceId, deviceId)));
  }

  /** Saves an Agent-specific pool grant, or removes it to restore synchronization. */
  async saveOverride(poolId: string, agentId: string, rules: DevicePoolMatrix | null) {
    await this.requirePool(poolId, true);
    if (rules === null) {
      await this.db
        .delete(agentDevicePoolPolicies)
        .where(
          and(
            eq(agentDevicePoolPolicies.poolId, poolId),
            eq(agentDevicePoolPolicies.agentId, agentId),
          ),
        );
      return;
    }
    await this.assertNamedMembers(rules);
    const [agent] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          this.workspaceId
            ? and(
                eq(agents.workspaceId, this.workspaceId),
                or(eq(agents.userId, this.userId), eq(agents.visibility, 'public')),
              )
            : and(isNull(agents.workspaceId), eq(agents.userId, this.userId)),
        ),
      )
      .limit(1);
    if (!agent) throw new DevicePoolAccessError('Agent is outside the pool scope');
    await this.db
      .insert(agentDevicePoolPolicies)
      .values({ agentId, poolId, rules })
      .onConflictDoUpdate({
        target: [agentDevicePoolPolicies.poolId, agentDevicePoolPolicies.agentId],
        set: { rules, updatedAt: new Date() },
      });
  }

  /** Returns only complete authorization paths, retaining the winning pool and rule for auditing. */
  async authorizedDevices(context: DevicePoolRunContext) {
    await this.assertScope();
    if (context.blocked || context.workspaceId !== this.workspaceId) return [];
    const rows = await this.db
      .select()
      .from(devices)
      .where(
        this.workspaceId
          ? eq(devices.workspaceId, this.workspaceId)
          : and(isNull(devices.workspaceId), eq(devices.userId, this.userId)),
      );
    const grants = await this.db
      .select({
        deviceId: devicePoolDevices.deviceId,
        pool: devicePools,
        override: agentDevicePoolPolicies.rules,
      })
      .from(devicePoolDevices)
      .innerJoin(devicePools, eq(devicePoolDevices.poolId, devicePools.id))
      .leftJoin(
        agentDevicePoolPolicies,
        and(
          eq(agentDevicePoolPolicies.poolId, devicePools.id),
          eq(agentDevicePoolPolicies.agentId, context.agentId),
        ),
      )
      .where(this.scope());
    const actorIsMember = !!context.actorUserId && (await this.isMember(context.actorUserId));
    const subjects: DevicePoolSubject[] = actorIsMember
      ? [`user:${context.actorUserId}`, 'workspaceMember', 'everyone']
      : ['everyone'];
    return rows.flatMap<{
      device: (typeof rows)[number];
      poolId: string | null;
      decision: DevicePoolDecision;
    }>((device) => {
      for (const grant of grants.filter((g) => g.deviceId === device.id)) {
        const policy = devicePoolPolicySchema.safeParse(grant.pool.policy);
        const override = devicePoolMatrixSchema.safeParse(grant.override ?? {});
        if (!policy.success || !override.success) continue;
        const decision = evaluateDevicePoolUse({
          policy: policy.data,
          override: override.data,
          subjects,
          isDeviceOwner:
            device.userId === context.actorUserId && (!this.workspaceId || actorIsMember),
          trigger: context.trigger,
        });
        if (decision.allowed) return [{ device, poolId: grant.pool.id, decision }];
      }
      // A removed explicit grant must not silently restore the legacy public-device path.
      if (device.poolManaged || context.trigger === 'bot' || !context.actorUserId) return [];
      const owner = device.userId === context.actorUserId && (!this.workspaceId || actorIsMember);
      const member = actorIsMember;
      if (owner || (device.visibility === 'public' && member)) {
        return [
          { device, poolId: null, decision: { allowed: true, source: 'pool-default' as const } },
        ];
      }
      return [];
    });
  }
}
