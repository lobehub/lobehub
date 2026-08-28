// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  isResourceAccessLevelAllowed,
  resourcePermissions,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ResourcePermissionModel } from '../resourcePermission';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'rp-test-owner';
const memberA = 'rp-test-member-a';
const memberB = 'rp-test-member-b';
const wsId = 'rp-test-ws';
const wsId2 = 'rp-test-ws-2';
const agentId = 'rp-test-agent';

const model = new ResourcePermissionModel(serverDB, wsId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
  await serverDB.insert(users).values([
    { fullName: 'Owner', id: ownerId },
    { fullName: 'Member A', id: memberA },
    { fullName: 'Member B', id: memberB },
  ]);
  await serverDB.insert(workspaces).values([
    { id: wsId, name: 'WS', primaryOwnerId: ownerId, slug: 'rp-ws' },
    { id: wsId2, name: 'WS2', primaryOwnerId: ownerId, slug: 'rp-ws-2' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(resourcePermissions);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('ResourcePermissionModel', () => {
  it.each([
    ['agent', 'edit'],
    ['agentGroup', 'edit'],
    ['document', 'view'],
  ] as const)(
    'falls back to %s-specific default %s without a row',
    async (resourceType, expected) => {
      expect(await model.getAccessLevel(resourceType, agentId)).toBeNull();
      expect(await model.getEffectiveAccessLevel(resourceType, agentId)).toBe(expected);
    },
  );

  it.each([
    ['agent', 'view'],
    ['agent', 'use'],
    ['agent', 'edit'],
    ['agentGroup', 'view'],
    ['agentGroup', 'use'],
    ['agentGroup', 'edit'],
    ['document', 'view'],
    ['document', 'edit'],
  ] as const)('explicitly stores %s %s access', async (resourceType, accessLevel) => {
    await model.setAccessLevel(resourceType, agentId, accessLevel, ownerId);

    expect(await model.getAccessLevel(resourceType, agentId)).toBe(accessLevel);
    expect(await model.getEffectiveAccessLevel(resourceType, agentId)).toBe(accessLevel);
  });

  it.each([
    ['agent', 'use', true],
    ['agent', 'view', true],
    ['agentGroup', 'use', true],
    ['agentGroup', 'view', true],
    ['document', 'view', true],
    ['document', 'use', false],
  ] as const)('validates %s %s as %s', (resourceType, accessLevel, expected) => {
    expect(isResourceAccessLevelAllowed(resourceType, accessLevel)).toBe(expected);
  });

  it('keeps an explicit row when setting edit', async () => {
    await model.setAccessLevel('agent', agentId, 'use', ownerId);
    await model.setAccessLevel('agent', agentId, 'edit', ownerId);

    expect(await model.getAccessLevel('agent', agentId)).toBe('edit');
    const rows = await serverDB.select().from(resourcePermissions);
    expect(rows).toHaveLength(1);
  });

  it('set is idempotent and updates the access level on conflict', async () => {
    await model.setAccessLevel('agent', agentId, 'edit', ownerId);
    await model.setAccessLevel('agent', agentId, 'use', ownerId);

    expect(await model.getAccessLevel('agent', agentId)).toBe('use');
    const rows = await serverDB.select().from(resourcePermissions);
    expect(rows).toHaveLength(1);
  });

  it('is isolated per workspace and per resource type', async () => {
    await model.setAccessLevel('agent', agentId, 'use', ownerId);

    const otherWs = new ResourcePermissionModel(serverDB, wsId2);
    expect(await otherWs.getAccessLevel('agent', agentId)).toBeNull();
    expect(await model.getAccessLevel('agentGroup', agentId)).toBeNull();
  });

  it('removeAll clears every row of a resource', async () => {
    await model.setAccessLevel('agent', agentId, 'use', ownerId);
    await model.removeAll('agent', agentId);

    expect(await model.getAccessLevel('agent', agentId)).toBeNull();
  });
});

describe('ResourcePermissionModel collaborators', () => {
  const kbId = 'rp-test-kb';

  it('grants and lists collaborators in a stable order', async () => {
    await model.upsertCollaborators({
      accessLevel: 'edit',
      createdBy: ownerId,
      resourceId: kbId,
      resourceType: 'knowledgeBase',
      // Inserted B-then-A: one batch shares a `created_at` (`now()` is the
      // transaction timestamp), so the asserted order can only come from the
      // userId tie-breaker, never from the insertion order.
      userIds: [memberB, memberA],
    });

    const rows = await model.listCollaborators('knowledgeBase', kbId);
    expect(rows.map((r) => r.userId)).toEqual([memberA, memberB]);
    expect(rows.every((r) => r.accessLevel === 'edit')).toBe(true);
  });

  it('a collaborator grant never leaks into the workspace-wide level', async () => {
    await model.upsertCollaborators({
      accessLevel: 'edit',
      createdBy: ownerId,
      resourceId: kbId,
      resourceType: 'knowledgeBase',
      userIds: [memberA],
    });

    // The workspace-wide subject has no explicit row, so the default applies —
    // the per-member row must not satisfy the workspace-wide read.
    expect(await model.getAccessLevel('knowledgeBase', kbId)).toBeNull();
    expect(await model.getEffectiveAccessLevel('knowledgeBase', kbId)).toBe('edit');

    await model.setAccessLevel('knowledgeBase', kbId, 'use', ownerId);
    expect(await model.getAccessLevel('knowledgeBase', kbId)).toBe('use');
  });

  it('the workspace-wide row never leaks into collaborator reads', async () => {
    await model.setAccessLevel('knowledgeBase', kbId, 'use', ownerId);

    expect(await model.listCollaborators('knowledgeBase', kbId)).toEqual([]);
    expect(await model.getCollaboratorLevel('knowledgeBase', kbId, memberA)).toBeNull();
    expect(await model.getCollaboratorResourceIds('knowledgeBase', memberA, 'use')).toEqual([]);
  });

  it('workspace-wide row and grants upsert independently on their own indexes', async () => {
    await model.setAccessLevel('knowledgeBase', kbId, 'use', ownerId);
    await model.setAccessLevel('knowledgeBase', kbId, 'edit', ownerId);
    await model.upsertCollaborators({
      accessLevel: 'use',
      createdBy: ownerId,
      resourceId: kbId,
      resourceType: 'knowledgeBase',
      userIds: [memberA],
    });
    await model.upsertCollaborators({
      accessLevel: 'edit',
      createdBy: memberB,
      resourceId: kbId,
      resourceType: 'knowledgeBase',
      userIds: [memberA],
    });

    // The workspace-wide partial index keeps that subject unique: two sets =
    // one row updated, and the re-graded grant stays one row too.
    const rows = await serverDB.select().from(resourcePermissions);
    expect(rows).toHaveLength(2);
    expect(await model.getAccessLevel('knowledgeBase', kbId)).toBe('edit');
    expect(await model.getCollaboratorLevel('knowledgeBase', kbId, memberA)).toBe('edit');
  });

  it('getCollaboratorResourceIds matches the exact level and workspace scope', async () => {
    await model.upsertCollaborators({
      accessLevel: 'edit',
      createdBy: ownerId,
      resourceId: kbId,
      resourceType: 'knowledgeBase',
      userIds: [memberA],
    });
    await model.upsertCollaborators({
      accessLevel: 'use',
      createdBy: ownerId,
      resourceId: 'rp-test-kb-2',
      resourceType: 'knowledgeBase',
      userIds: [memberA],
    });
    await new ResourcePermissionModel(serverDB, wsId2).upsertCollaborators({
      accessLevel: 'edit',
      createdBy: ownerId,
      resourceId: 'rp-test-kb-3',
      resourceType: 'knowledgeBase',
      userIds: [memberA],
    });

    expect(await model.getCollaboratorResourceIds('knowledgeBase', memberA, 'edit')).toEqual([
      kbId,
    ]);
    expect(await model.getCollaboratorResourceIds('knowledgeBase', memberB, 'edit')).toEqual([]);
  });

  it('removeCollaborators revokes only the given members', async () => {
    await model.upsertCollaborators({
      accessLevel: 'edit',
      createdBy: ownerId,
      resourceId: kbId,
      resourceType: 'knowledgeBase',
      userIds: [memberA, memberB],
    });

    await model.removeCollaborators('knowledgeBase', kbId, [memberA]);

    const rows = await model.listCollaborators('knowledgeBase', kbId);
    expect(rows.map((r) => r.userId)).toEqual([memberB]);
  });

  it('removeMemberGrants revokes one member across the workspace, sparing the workspace-wide row', async () => {
    await model.setAccessLevel('knowledgeBase', kbId, 'use', ownerId);
    await model.upsertCollaborators({
      accessLevel: 'edit',
      createdBy: ownerId,
      resourceId: kbId,
      resourceType: 'knowledgeBase',
      userIds: [memberA, memberB],
    });
    await model.upsertCollaborators({
      accessLevel: 'edit',
      createdBy: ownerId,
      resourceId: 'rp-test-kb-2',
      resourceType: 'knowledgeBase',
      userIds: [memberA],
    });

    await model.removeMemberGrants(memberA);

    expect(await model.getCollaboratorLevel('knowledgeBase', kbId, memberA)).toBeNull();
    expect(await model.getCollaboratorResourceIds('knowledgeBase', memberA, 'edit')).toEqual([]);
    expect(await model.getCollaboratorLevel('knowledgeBase', kbId, memberB)).toBe('edit');
    expect(await model.getAccessLevel('knowledgeBase', kbId)).toBe('use');
  });

  it('removeAll clears the workspace-wide row and every grant together', async () => {
    await model.setAccessLevel('knowledgeBase', kbId, 'use', ownerId);
    await model.upsertCollaborators({
      accessLevel: 'edit',
      createdBy: ownerId,
      resourceId: kbId,
      resourceType: 'knowledgeBase',
      userIds: [memberA],
    });

    await model.removeAll('knowledgeBase', kbId);

    expect(await model.getAccessLevel('knowledgeBase', kbId)).toBeNull();
    expect(await model.listCollaborators('knowledgeBase', kbId)).toEqual([]);
  });
});
