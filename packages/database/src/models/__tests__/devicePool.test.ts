// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';
import { DevicePoolAccessService } from '@/server/services/deviceGateway/poolAccess';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  agents,
  devices,
  users,
  workspaceMembers,
  workspaces,
} from '../../schemas';
import { DevicePoolAccessError, DevicePoolModel } from '../devicePool';

const db = await getTestDB();
const owner = 'pool-owner';
const member = 'pool-member';
const outsider = 'pool-outsider';
const workspaceId = 'pool-workspace';
const model = new DevicePoolModel(db, owner, workspaceId);
const memberModel = new DevicePoolModel(db, member, workspaceId);
const context = {
  actorUserId: owner,
  agentId: 'pool-agent',
  blocked: false,
  trigger: 'chat' as const,
  workspaceId,
};

beforeEach(async () => {
  await db.delete(agentOperations);
  await db.delete(users);
  await db.insert(users).values([{ id: owner }, { id: member }, { id: outsider }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Pool workspace', primaryOwnerId: owner, slug: workspaceId });
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: owner, role: 'owner' },
    { workspaceId, userId: member },
  ]);
  await db
    .insert(agents)
    .values({ id: context.agentId, userId: owner, workspaceId, visibility: 'public' });
});

/** Creates a registered workspace device without bypassing policy ownership checks. */
const createDevice = async (userId = owner) => {
  const [device] = await db
    .insert(devices)
    .values({
      userId,
      workspaceId,
      deviceId: 'pool-machine',
      identitySource: 'machine-id',
      visibility: 'public',
    })
    .returning();
  return device;
};

/** @example Pool authorization is tested against migrated PGlite tables and real scoped queries. */
describe('DevicePoolModel', () => {
  /** @example Specific verified members override groups and lose access when removed. */
  it('matches named members before groups and rechecks membership', async () => {
    const pool = await model.create('Named grants');
    const device = await createDevice();
    await model.addDevice(pool.id, device.id);
    await model.update(pool.id, {
      policy: {
        ...pool.policy,
        rules: {
          chat: { everyone: 'deny', workspaceMember: 'deny', [`user:${member}`]: 'allow' },
        },
      },
    });
    // ROOT CAUSE:
    // Group-only matching never matched a specific user's rule. Current members now match their verified ID first.
    /** @example The named rule overrides workspace deny. */
    expect(await model.authorizedDevices({ ...context, actorUserId: member })).toHaveLength(1);
    /** @example Another user cannot borrow this grant. */
    expect(await model.authorizedDevices(context)).toHaveLength(0);
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, member));
    /** @example Removed members cannot use a retained named grant. */
    expect(await model.authorizedDevices({ ...context, actorUserId: member })).toHaveLength(0);
  });

  /** @example Named overrides cannot target users outside the current workspace. */
  it('rejects outsider rules for pools and Agents', async () => {
    const pool = await model.create('Scope');
    const rules = { chat: { [`user:${outsider}`]: 'allow' as const } };
    /** @example Pool policies reject out-of-scope identities. */
    await expect(model.update(pool.id, { policy: { ...pool.policy, rules } })).rejects.toThrow(
      DevicePoolAccessError,
    );
    /** @example Agent overrides enforce the same scope. */
    await expect(model.saveOverride(pool.id, context.agentId, rules)).rejects.toThrow(
      DevicePoolAccessError,
    );
  });

  /** @example Name autosave must not replace independently saved permissions. */
  it('updates pool metadata and policy independently', async () => {
    const pool = await model.create('Original');
    const policy = { ...pool.policy, rules: { chat: { everyone: 'deny' as const } } };
    await model.update(pool.id, { policy });
    await model.update(pool.id, { name: 'Renamed' });
    // ROOT CAUSE:
    // Rename submitted a full cached policy, allowing metadata edits to replace newer grants.
    // A partial update now writes only fields explicitly supplied by the active control.
    /** @example Renaming preserves the latest persisted policy. */
    expect(await model.detail(pool.id)).toMatchObject({ name: 'Renamed', policy });
    await model.update(pool.id, { policy: pool.policy });
    /** @example Permission changes preserve the independently saved name. */
    expect(await model.detail(pool.id)).toMatchObject({ name: 'Renamed', policy: pool.policy });
  });

  /** @example Pool cards show live device counts without exposing another member's private Agent overrides. */
  it('summarizes pool devices and only visible Agent overrides', async () => {
    const pool = await model.create('Summary pool');
    const device = await createDevice();
    await model.addDevice(pool.id, device.id);
    await db
      .insert(agents)
      .values({ id: 'private-pool-agent', userId: owner, workspaceId, visibility: 'private' });
    await model.saveOverride(pool.id, context.agentId, { bot: { everyone: 'allow' } });
    await model.saveOverride(pool.id, 'private-pool-agent', { bot: { workspaceMember: 'allow' } });
    const [owned] = await model.list();
    /** @example The creator sees both its private and public Agent customizations. */
    expect(owned).toMatchObject({ deviceCount: 1, canManage: true });
    /** @example Both visible override IDs are present without ordering assumptions. */
    expect(owned.overrideAgentIds).toEqual(
      expect.arrayContaining([context.agentId, 'private-pool-agent']),
    );
    const [shared] = await memberModel.list();
    /** @example A member sees the device count but no private Agent identity. */
    expect(shared).toMatchObject({
      deviceCount: 1,
      canManage: false,
      overrideAgentIds: [context.agentId],
    });
    await model.removeDevice(pool.id, device.id);
    /** @example Removing a device updates the next list response. */
    expect((await model.list())[0].deviceCount).toBe(0);
  });

  /** @example A public device is legacy-visible, then revoked pool membership cannot restore that grant. */
  it('does not regain legacy visibility after the last pool is removed', async () => {
    const device = await createDevice();
    /** @example Legacy workspace public use works before pool management. */
    expect(await memberModel.authorizedDevices({ ...context, actorUserId: member })).toHaveLength(
      1,
    );
    const pool = await model.create('Owned pool');
    await model.addDevice(pool.id, device.id);
    /** @example Joining a pool activates its device-owner defaults. */
    expect(await memberModel.authorizedDevices({ ...context, actorUserId: member })).toHaveLength(
      0,
    );
    await model.removeDevice(pool.id, device.id);
    /** @example Last-membership revocation stays denied, even for the creator. */
    expect(await model.authorizedDevices(context)).toHaveLength(0);
    await model.addDevice(pool.id, device.id);
    /** @example Explicit reauthorization recovers access. */
    expect(await model.authorizedDevices(context)).toHaveLength(1);
    await model.remove(pool.id);
    /** @example Deleting a pool also cannot resurrect the legacy grant. */
    expect(await model.authorizedDevices(context)).toHaveLength(0);
  });

  /** @example An allowed pool remains usable even when another pool hard-denies Bot. */
  it('evaluates multiple pools independently and scopes Agent overrides', async () => {
    const device = await createDevice();
    const blocked = await model.create('Restricted');
    const allowed = await model.create('Bot enabled');
    await model.addDevice(blocked.id, device.id);
    await model.addDevice(allowed.id, device.id);
    await model.update(blocked.id, { policy: { ...blocked.policy, blockedTriggers: ['bot'] } });
    await model.saveOverride(allowed.id, context.agentId, { bot: { everyone: 'allow' } });
    const bot = { ...context, actorUserId: undefined, trigger: 'bot' as const };
    /** @example Exactly the second pool supplies the complete grant. */
    expect(await model.authorizedDevices(bot)).toMatchObject([{ poolId: allowed.id }]);
    /** @example A different Agent cannot reuse that override. */
    expect(await model.authorizedDevices({ ...bot, agentId: 'other-agent' })).toHaveLength(0);
    await model.saveOverride(allowed.id, context.agentId, null);
    /** @example Restoring synchronization immediately reinstates the default Bot deny. */
    expect(await model.authorizedDevices(bot)).toHaveLength(0);
  });

  /** @example Pool use permission never grants editing or another owner's enrollment consent. */
  it('separates pool editing, use, and device ownership', async () => {
    const device = await createDevice();
    const pool = await model.create('Owned');
    /** @example Members cannot add another person's machine. */
    await expect(memberModel.addDevice(pool.id, device.id)).rejects.toBeInstanceOf(
      DevicePoolAccessError,
    );
    /** @example Members cannot edit another person's pool. */
    await expect(
      memberModel.update(pool.id, { name: 'Hijacked', policy: pool.policy }),
    ).rejects.toBeInstanceOf(DevicePoolAccessError);
    /** @example Membership is required even to list pools. */
    await expect(new DevicePoolModel(db, outsider, workspaceId).list()).rejects.toBeInstanceOf(
      DevicePoolAccessError,
    );
    const memberPool = await memberModel.create('Member pool');
    await model.addDevice(memberPool.id, device.id);
    /** @example The device owner can revoke previously delegated access. */
    await expect(model.removeDevice(memberPool.id, device.id)).resolves.toBeUndefined();
  });

  /** @example Creating a pool does not confer ownership of devices contributed by other members. */
  it('uses device ownership rather than pool creation for implicit access', async () => {
    const device = await createDevice(member);
    const pool = await model.create('Shared ownership');
    await memberModel.addDevice(pool.id, device.id);
    // ROOT CAUSE:
    // The former Me rule matched the pool creator and gave access to someone else's device.
    // Ownership now comes from each device row, after explicit identity rules are evaluated.
    /** @example The creator cannot use another member's device without a grant. */
    expect(await model.authorizedDevices(context)).toHaveLength(0);
    /** @example The contributor retains direct access to their own device. */
    expect(await model.authorizedDevices({ ...context, actorUserId: member })).toHaveLength(1);
    /** @example An explicit Everyone deny overrides even the contributor's default. */
    await model.update(pool.id, {
      policy: {
        ...pool.policy,
        rules: { chat: { everyone: 'deny' } },
      },
    });
    expect(await model.authorizedDevices({ ...context, actorUserId: member })).toHaveLength(0);
  });

  /** @example Changing active workspace membership affects the next authorization query. */
  it('checks current actor membership and does not substitute the storage owner', async () => {
    const device = await createDevice();
    const pool = await model.create('Members');
    await model.addDevice(pool.id, device.id);
    await model.update(pool.id, {
      policy: {
        ...pool.policy,
        rules: { bot: { workspaceMember: 'allow' } },
      },
    });
    /** @example A verified member identity can match a configured Bot grant. */
    expect(
      await model.authorizedDevices({ ...context, actorUserId: member, trigger: 'bot' }),
    ).toHaveLength(1);
    /** @example Unmapped Bot senders only match Everyone. */
    expect(
      await model.authorizedDevices({ ...context, actorUserId: undefined, trigger: 'bot' }),
    ).toHaveLength(0);
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, member)),
      );
    /** @example A removed actor loses the member grant during the same operation. */
    expect(
      await model.authorizedDevices({ ...context, actorUserId: member, trigger: 'bot' }),
    ).toHaveLength(0);
  });

  /** @example A device owner who left the workspace must lose implicit access there. */
  it('does not retain owner access after leaving a workspace', async () => {
    const device = await createDevice(member);
    const pool = await memberModel.create('Member-owned pool');
    await memberModel.addDevice(pool.id, device.id);
    /** @example A current member receives device-owner defaults. */
    expect(await model.authorizedDevices({ ...context, actorUserId: member })).toHaveLength(1);
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, member)),
      );
    /** @example Storage under another active member cannot preserve departed owner privileges. */
    expect(await model.authorizedDevices({ ...context, actorUserId: member })).toHaveLength(0);
  });

  /** @example A personal device cannot be enrolled into a workspace pool by guessing its row ID. */
  it('rejects cross-scope devices, Agents, and run contexts', async () => {
    const pool = await model.create('Workspace');
    const [personal] = await db
      .insert(devices)
      .values({ userId: owner, deviceId: 'personal-machine', identitySource: 'machine-id' })
      .returning();
    await db.insert(agents).values({ id: 'personal-agent', userId: owner });
    /** @example Owner equality does not erase scope. */
    await expect(model.addDevice(pool.id, personal.id)).rejects.toBeInstanceOf(
      DevicePoolAccessError,
    );
    /** @example Agent overrides require matching resource scope. */
    await expect(model.saveOverride(pool.id, 'personal-agent', {})).rejects.toBeInstanceOf(
      DevicePoolAccessError,
    );
    /** @example A foreign durable context never grants use. */
    expect(await model.authorizedDevices({ ...context, workspaceId: undefined })).toHaveLength(0);
  });
});

/** @example Durable provenance protects descendants and every dispatch boundary. */
describe('DevicePoolAccessService', () => {
  beforeEach(async () => {
    // These integration cases exercise the opt-in policy path; missing preferences use legacy access.
    await db
      .update(users)
      .set({ preference: { lab: { enableDevicePools: true } } })
      .where(eq(users.id, owner));
  });
  /** @example A Bot child Task must retain Bot identity and the original Agent's grant. */
  it('inherits the root actor, trigger, and Agent across child runs', async () => {
    const access = new DevicePoolAccessService(db, owner, workspaceId);
    const root = await access.createContext({
      agentId: context.agentId,
      bot: true,
      shareVisitor: false,
      task: false,
    });
    await db.insert(agentOperations).values({
      id: 'root-bot',
      userId: owner,
      workspaceId,
      status: 'running',
      metadata: { devicePoolContext: root },
    });
    const child = await access.createContext({
      agentId: 'child-agent',
      bot: false,
      parentOperationId: 'root-bot',
      shareVisitor: false,
      task: true,
    });
    /** @example Switching execution to a Task cannot turn an external Bot sender into the owner. */
    expect(child).toEqual(root);
    /** @example An unmapped sender has no internal user identity. */
    expect(child).toBeDefined();
    expect(child?.actorUserId).toBeUndefined();
  });

  /** @example Account-link routing can supply a verified sender; absent metadata stays denied. */
  it('accepts verified Bot identities but rejects missing and foreign operations', async () => {
    const access = new DevicePoolAccessService(db, owner, workspaceId);
    /** @example Only the explicit sender is used, not the storage owner. */
    expect(
      await access.createContext({
        actorUserId: member,
        agentId: context.agentId,
        bot: true,
        shareVisitor: false,
        task: false,
      }),
    ).toMatchObject({ actorUserId: member, trigger: 'bot' });
    await db.insert(agentOperations).values({
      id: 'foreign-operation',
      userId: member,
      workspaceId,
      status: 'running',
      metadata: { devicePoolContext: context },
    });
    /** @example A guessed operation belonging to another principal cannot lend its grants. */
    expect(await access.loadContext('foreign-operation')).toMatchObject({ blocked: true });
    /** @example Legacy/missing operation metadata does not fall back to owner Chat. */
    expect(await access.loadContext('missing')).toMatchObject({ blocked: true });
  });

  /** @example Revoking a pool between tool calls takes effect without restarting the run. */
  it('rechecks grants immediately before dispatch and denies missing provenance', async () => {
    const device = await createDevice();
    const pool = await model.create('Dispatch');
    await model.addDevice(pool.id, device.id);
    await db.insert(agentOperations).values({
      id: 'dispatch-operation',
      userId: owner,
      workspaceId,
      status: 'running',
      metadata: { devicePoolContext: context },
    });
    /** @example The initial persisted grant permits this target. */
    await expect(
      resolveDeviceDispatchAuthorizationFailure(
        db,
        owner,
        device.deviceId,
        workspaceId,
        'dispatch-operation',
      ),
    ).resolves.toBeUndefined();
    await model.removeDevice(pool.id, device.id);
    /** @example A stale activeDeviceId cannot bypass revocation. */
    await expect(
      resolveDeviceDispatchAuthorizationFailure(
        db,
        owner,
        device.deviceId,
        workspaceId,
        'dispatch-operation',
      ),
    ).resolves.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
    /** @example Forgetting operationId is denied instead of becoming interactive Chat. */
    await expect(
      resolveDeviceDispatchAuthorizationFailure(db, owner, device.deviceId, workspaceId),
    ).resolves.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });
});
