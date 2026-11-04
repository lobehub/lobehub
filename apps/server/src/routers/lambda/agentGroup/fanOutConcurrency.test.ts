// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as AgentModelModule from '@/database/models/agent';
import * as ChatGroupModelModule from '@/database/models/chatGroup';
import * as ResourcePermissionModelModule from '@/database/models/resourcePermission';
import * as UserModelModule from '@/database/models/user';
import * as AgentGroupRepoModule from '@/database/repositories/agentGroup';
import * as AgentGroupServiceModule from '@/server/services/agentGroup';

import { getResourceConfigAccess } from '../_helpers/resourceConfigGuard';
import { getWorkspaceGroupVirtualAgentIds } from '../_helpers/workspaceAgentGuard';
import { agentGroupRouter } from '.';
import { PERMISSION_WRITE_CONCURRENCY } from './procedures';
import { applyGroupAccessLevel } from './visibility';

vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn().mockResolvedValue(true),
  isWorkspacePrimaryOwner: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: vi.fn(),
  assertCanPerformResourceAction: vi.fn(),
  buildResourcePermissionState: vi.fn(),
  canPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
  isCollaborativeBuiltinAgent: vi.fn(() => false),
}));
vi.mock('../_helpers/workspaceAgentGuard', () => ({
  getWorkspaceAgentParentGroupIds: vi.fn().mockResolvedValue([]),
  getWorkspaceGroupVirtualAgentIds: vi.fn().mockResolvedValue([]),
}));
vi.mock('../_helpers/resourceConfigGuard', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getResourceConfigAccess: vi.fn() };
});

/** Wraps an async fn so each call resolves on a later tick, recording peak concurrency. */
const trackInFlight = <A extends unknown[], R>(fn: (...args: A) => R) => {
  const stats = { inFlight: 0, max: 0 };
  const tracked = async (...args: A) => {
    stats.inFlight += 1;
    stats.max = Math.max(stats.max, stats.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    stats.inFlight -= 1;
    return fn(...args);
  };
  return { stats, tracked };
};

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

describe('agentGroup router fan-outs are bounded', () => {
  let permissionModel: { getAccessLevel: any; setAccessLevel: any };
  let writes: ReturnType<typeof trackInFlight>;

  beforeEach(() => {
    vi.restoreAllMocks();
    writes = trackInFlight(() => undefined);
    permissionModel = {
      getAccessLevel: vi.fn().mockResolvedValue('use'),
      setAccessLevel: vi.fn(writes.tracked),
    };
    vi.spyOn(ResourcePermissionModelModule, 'ResourcePermissionModel').mockImplementation(
      function () {
        return permissionModel as any;
      },
    );
  });

  it('applyGroupAccessLevel cascades to every virtual agent with capped concurrency', async () => {
    const agentIds = ids('agent', 12);
    vi.mocked(getWorkspaceGroupVirtualAgentIds).mockResolvedValue(agentIds);

    await applyGroupAccessLevel({
      accessLevel: 'view',
      ctx: { serverDB: {} as any, userId: 'u1' },
      groupId: 'group-1',
      permissionModel: permissionModel as any,
      workspaceId: 'ws-1',
    });

    expect(permissionModel.setAccessLevel.mock.calls).toEqual([
      ['agentGroup', 'group-1', 'view', 'u1'],
      ...agentIds.map((id) => ['agent', id, 'view', 'u1']),
    ]);
    // The group write runs alongside the capped agent cascade.
    expect(writes.stats.max).toBe(PERMISSION_WRITE_CONCURRENCY + 1);
  });

  it('batchCreateAgentsInGroup writes member access levels with capped concurrency', async () => {
    const created = ids('agent', 12).map((id, i) => ({
      id,
      visibility: i === 3 ? 'private' : 'public',
    }));
    vi.spyOn(AgentModelModule, 'AgentModel').mockImplementation(function () {
      return { batchCreate: vi.fn().mockResolvedValue(created) } as any;
    });
    vi.spyOn(ChatGroupModelModule, 'ChatGroupModel').mockImplementation(function () {
      return { addAgentsToGroup: vi.fn() } as any;
    });

    const result = await agentGroupRouter
      .createCaller({ serverDB: {}, userId: 'u1', workspaceId: 'ws-1' } as any)
      .batchCreateAgentsInGroup({
        agents: created.map((agent) => ({ title: agent.id })),
        groupId: 'group-1',
      });

    expect(result.agentIds).toEqual(created.map((agent) => agent.id));
    expect(permissionModel.setAccessLevel.mock.calls).toEqual(
      created
        .filter((agent) => agent.visibility !== 'private')
        .map((agent) => ['agent', agent.id, 'use', 'u1']),
    );
    expect(writes.stats.max).toBe(PERMISSION_WRITE_CONCURRENCY);
  });

  it('createGroupWithMembers writes member access levels with capped concurrency', async () => {
    const created = ids('agent', 12).map((id) => ({ id, visibility: 'public' }));
    vi.spyOn(AgentModelModule, 'AgentModel').mockImplementation(function () {
      return { batchCreate: vi.fn().mockResolvedValue(created) } as any;
    });
    vi.spyOn(AgentGroupRepoModule, 'AgentGroupRepository').mockImplementation(function () {
      return {
        createGroupWithSupervisor: vi.fn().mockResolvedValue({
          group: { id: 'group-1', visibility: 'public' },
          supervisorAgentId: 'supervisor-1',
        }),
      } as any;
    });
    vi.spyOn(AgentGroupServiceModule, 'AgentGroupService').mockImplementation(function () {
      return { normalizeGroupConfig: (config: unknown) => config } as any;
    });

    const result = await agentGroupRouter
      .createCaller({ serverDB: {}, userId: 'u1', workspaceId: 'ws-1' } as any)
      .createGroupWithMembers({
        groupConfig: { title: 'Group' },
        members: created.map((agent) => ({ title: agent.id })),
      });

    expect(result).toEqual({
      agentIds: created.map((agent) => agent.id),
      groupId: 'group-1',
      supervisorAgentId: 'supervisor-1',
    });
    expect(permissionModel.setAccessLevel.mock.calls.map((call: any[]) => call[1])).toEqual([
      'group-1',
      'supervisor-1',
      ...created.map((agent) => agent.id),
    ]);
    // The two fixed group/supervisor writes run alongside the capped member writes.
    expect(writes.stats.max).toBe(PERMISSION_WRITE_CONCURRENCY + 2);
  });

  it('getGroups keeps result order and caps config-access lookups', async () => {
    const groups = ids('group', 12).map((id) => ({
      agents: ids(`${id}-agent`, 7).map((agentId) => ({ id: agentId, systemRole: 'secret' })),
      config: { systemPrompt: 'secret' },
      id,
    }));
    const access: Record<string, 'full' | 'none' | 'profile'> = {
      'group-1': 'none',
      'group-2': 'profile',
      'group-3-agent-0': 'none',
      'group-3-agent-1': 'profile',
    };
    const lookups = trackInFlight(
      (_ctx: unknown, _type: string, resourceId: string) => access[resourceId] ?? 'full',
    );
    vi.mocked(getResourceConfigAccess).mockImplementation(lookups.tracked as any);
    vi.spyOn(AgentGroupServiceModule, 'AgentGroupService').mockImplementation(function () {
      return {
        getGroups: vi.fn().mockResolvedValue(groups),
        mergeAgentsDefaultConfig: (_: unknown, agents: unknown) => agents,
      } as any;
    });
    vi.spyOn(UserModelModule, 'UserModel').mockImplementation(function () {
      return { getUserSettingsDefaultAgentConfig: vi.fn().mockResolvedValue({}) } as any;
    });

    const result = await agentGroupRouter
      .createCaller({ serverDB: {}, userId: 'u1', workspaceId: 'ws-1' } as any)
      .getGroups();

    expect(result.map((group) => group.id)).toEqual(
      groups.map((group) => group.id).filter((id) => id !== 'group-1'),
    );
    expect(result[1]).not.toHaveProperty('agents.0.systemRole');
    const group3 = result.find((group) => group.id === 'group-3')!;
    expect(group3.agents.map((agent: any) => agent.id)).toEqual(ids('group-3-agent', 7).slice(1));
    expect(group3.agents[0]).not.toHaveProperty('systemRole');
    expect(group3.agents[1]).toHaveProperty('systemRole', 'secret');
    // 12 group lookups + 7 member lookups for each of the 10 full-access groups.
    expect(getResourceConfigAccess).toHaveBeenCalledTimes(12 + 10 * 7);
    // Member lookups nest inside the group fan-out, so the bound is the cap squared.
    expect(lookups.stats.max).toBeGreaterThan(1);
    expect(lookups.stats.max).toBeLessThanOrEqual(5 * 5);
  });
});
