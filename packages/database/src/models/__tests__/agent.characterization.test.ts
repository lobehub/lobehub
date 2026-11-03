// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  agentsToSessions,
  sessionGroups,
  sessions,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import * as agentModule from '../agent';
import { AgentModel } from '../agent';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../agentTransferJob';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-char-user';
const otherUserId = 'agent-char-other';

/** Former private helpers; excluded so the pin only covers the public surface. */
const PRIVATE_MEMBERS = new Set([
  'agentsFilesOwnership',
  'agentsKnowledgeBasesOwnership',
  'agentsToSessionsOwnership',
  'assertFixedExecutionTarget',
  'assertNotAgentBuilderProtectedWrite',
  'assertSessionGroupAssignable',
  'assertWorkspaceDeviceBinding',
  'buildQueryAgentsWhere',
  'collectBoundDeviceIds',
  'documentsOwnership',
  'enrichAgentWithKnowledge',
  'findOwnedGroupMemberships',
  'ownership',
  'queryGroupMemberships',
  'sanitizeAgencyConfigForWorkspace',
  'sessionsOwnership',
  'stripImmutableFields',
  'stripReservedSlug',
  'trashScope',
  'withWorkspaceSelectionPolicyDefaults',
]);

const PUBLIC_METHODS = [
  'assertDeletable',
  'batchCreate',
  'batchDelete',
  'checkByMarketIdentifier',
  'countAgents',
  'create',
  'createAgentFiles',
  'createAgentKnowledgeBase',
  'delete',
  'deleteAgentFile',
  'deleteAgentKnowledgeBase',
  'duplicate',
  'existsById',
  'existsOwnedById',
  'findAgentIdsBySessionIds',
  'findBySessionId',
  'findSessionIdsByAgentIds',
  'findTrashedByIds',
  'getAgentAgencyConfig',
  'getAgentAssignedKnowledge',
  'getAgentAvatarsByIds',
  'getAgentByForkedFromIdentifier',
  'getAgentByMarketIdentifier',
  'getAgentConfig',
  'getAgentConfigById',
  'getAgentDisplayFields',
  'getAgentModelConfig',
  'getAgentSnapshotForTaskCreate',
  'getAgentVisibility',
  'getAgentVisibilityMeta',
  'getAssignableSessionGroupVisibility',
  'getBuiltinAgent',
  'getGroupMembershipImpact',
  'getTopicShareSubject',
  'hasTrashedOwner',
  'listMessengerBindableAgents',
  'lockTrashedForPurge',
  'publishToWorkspace',
  'purge',
  'queryAgencyRoutingByIds',
  'queryAgents',
  'queryBoundToDevice',
  'rank',
  'resolveIdBySlug',
  'restore',
  'setVisibility',
  'softDelete',
  'toggleFile',
  'toggleKnowledgeBase',
  'touchUpdatedAt',
  'transferAgent',
  'transferAgentOwnership',
  'transferAgents',
  'transferHasForeignRows',
  'update',
  'updateConfig',
  'updateSessionGroupId',
  'updateSlug',
];

const deletedAt = new Date('2026-01-01T00:00:00.000Z');

let workspaceId = '';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  const [ws] = await serverDB
    .insert(workspaces)
    .values({ name: 'agent-char-ws', primaryOwnerId: userId, slug: 'agent-char-ws' })
    .returning();
  workspaceId = ws.id;

  await serverDB.insert(agents).values([
    {
      agencyConfig: { heterogeneousProvider: { type: 'claude-code' } } as any,
      id: 'own-public',
      slug: 'own-public-slug',
      title: 'Own public',
      userId,
      visibility: 'public',
    },
    {
      id: 'own-private',
      slug: 'own-private-slug',
      title: 'Own private',
      userId,
      visibility: 'private',
    },
    { id: 'foreign', slug: 'foreign-slug', title: 'Foreign', userId: otherUserId },
    {
      id: 'ws-member-private',
      slug: 'ws-member-private-slug',
      title: 'Workspace member private',
      userId: otherUserId,
      visibility: 'private',
      workspaceId,
    },
    {
      id: 'ws-member-public',
      slug: 'ws-member-public-slug',
      title: 'Workspace member public',
      userId: otherUserId,
      visibility: 'public',
      workspaceId,
    },
  ]);
  await serverDB.insert(sessions).values([
    { id: 'own-session', userId },
    { id: 'foreign-session', userId: otherUserId },
  ]);
  await serverDB.insert(agentsToSessions).values([
    { agentId: 'own-public', sessionId: 'own-session', userId },
    { agentId: 'foreign', sessionId: 'foreign-session', userId: otherUserId },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users);
});

describe('AgentModel - characterization', () => {
  describe('public surface', () => {
    it('exposes the same instance methods', () => {
      const model = new AgentModel(serverDB, userId);
      const methods = Object.keys(model)
        .filter((key) => typeof (model as any)[key] === 'function')
        .filter((key) => !PRIVATE_MEMBERS.has(key))
        .sort();

      expect(methods).toEqual(PUBLIC_METHODS);
    });

    it('keeps the runtime exports', () => {
      expect(Object.keys(agentModule).sort()).toEqual([
        'AGENT_OWNED_BY_GROUP',
        'AGENT_OWNERSHIP_STALE',
        'AGENT_SHARED_TRANSFER_BLOCKED',
        'AgentModel',
        'AgentOwnedByGroupError',
      ]);
      expect(agentModule.AGENT_OWNED_BY_GROUP).toBe('AGENT_OWNED_BY_GROUP');
      expect(agentModule.AGENT_OWNERSHIP_STALE).toBe('AGENT_OWNERSHIP_STALE');
      expect(agentModule.AGENT_SHARED_TRANSFER_BLOCKED).toBe('AGENT_SHARED_TRANSFER_BLOCKED');

      const error = new agentModule.AgentOwnedByGroupError([]);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('AGENT_OWNED_BY_GROUP');
      expect(error.name).toBe('AgentOwnedByGroupError');
      expect(error.groups).toEqual([]);
    });
  });

  describe('scoped reads', () => {
    it('getAgentVisibility reads only owned rows', async () => {
      const model = new AgentModel(serverDB, userId);

      expect(await model.getAgentVisibility('own-public')).toBe('public');
      expect(await model.getAgentVisibility('own-private')).toBe('private');
      expect(await model.getAgentVisibility('foreign')).toBeNull();
    });

    it('getAgentAgencyConfig resolves by id or slug within scope', async () => {
      const model = new AgentModel(serverDB, userId);

      expect(await model.getAgentAgencyConfig('own-public')).toEqual({
        heterogeneousProvider: { type: 'claude-code' },
      });
      expect(await model.getAgentAgencyConfig('own-public-slug')).toEqual({
        heterogeneousProvider: { type: 'claude-code' },
      });
      expect(await model.getAgentAgencyConfig('own-private')).toBeNull();
      expect(await model.getAgentAgencyConfig('foreign-slug')).toBeNull();
    });

    it('getAgentVisibilityMeta returns slug, author and visibility', async () => {
      const model = new AgentModel(serverDB, userId);

      expect(await model.getAgentVisibilityMeta('own-private')).toEqual({
        slug: 'own-private-slug',
        userId,
        visibility: 'private',
      });
      expect(await model.getAgentVisibilityMeta('foreign')).toBeNull();
    });

    it('resolveIdBySlug trims, and ignores blank or foreign slugs', async () => {
      const model = new AgentModel(serverDB, userId);

      expect(await model.resolveIdBySlug('  own-public-slug  ')).toBe('own-public');
      expect(await model.resolveIdBySlug('   ')).toBeNull();
      expect(await model.resolveIdBySlug('foreign-slug')).toBeNull();
    });

    it('getTopicShareSubject is owner-scoped personally and workspace-scoped in a workspace', async () => {
      const personal = new AgentModel(serverDB, userId);
      expect(await personal.getTopicShareSubject('own-public')).toEqual({
        agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
        userId,
        workspaceId: null,
      });
      expect(await personal.getTopicShareSubject('foreign')).toBeNull();

      // Workspace mode matches on workspace only — even another member's private agent.
      const member = new AgentModel(serverDB, userId, workspaceId);
      expect(await member.getTopicShareSubject('ws-member-private')).toEqual({
        agencyConfig: null,
        userId: otherUserId,
        workspaceId,
      });
      expect(await member.getTopicShareSubject('own-public')).toBeNull();
    });

    it('getAssignableSessionGroupVisibility returns the group bucket or throws', async () => {
      await serverDB.insert(sessionGroups).values([
        { id: 'own-group', name: 'Own', userId },
        { id: 'own-private-group', name: 'Own private', userId, visibility: 'private' },
        { id: 'foreign-group', name: 'Foreign', userId: otherUserId },
      ]);
      const model = new AgentModel(serverDB, userId);

      expect(await model.getAssignableSessionGroupVisibility('own-group')).toBe('public');
      expect(await model.getAssignableSessionGroupVisibility('own-private-group')).toBe('private');
      await expect(model.getAssignableSessionGroupVisibility('foreign-group')).rejects.toThrow(
        'Session group foreign-group not found in current scope',
      );
    });

    it('maps agents and legacy sessions both ways within scope', async () => {
      const model = new AgentModel(serverDB, userId);

      expect(await model.findSessionIdsByAgentIds([])).toEqual([]);
      expect(await model.findSessionIdsByAgentIds(['own-public', 'foreign'])).toEqual([
        'own-session',
      ]);
      expect(await model.findAgentIdsBySessionIds([])).toEqual([]);
      expect(await model.findAgentIdsBySessionIds(['own-session', 'foreign-session'])).toEqual([
        'own-public',
      ]);
    });
  });

  describe('recycle bin', () => {
    const liveIds = async () =>
      (await serverDB.select({ id: agents.id, isDeleted: agents.isDeleted }).from(agents))
        .filter((row) => !row.isDeleted)
        .map((row) => row.id)
        .sort();

    it('softDelete stamps only owned rows', async () => {
      const model = new AgentModel(serverDB, userId);

      expect(await model.softDelete([], { deletedAt })).toEqual([]);
      const trashed = await model.softDelete(['own-public', 'foreign'], { deletedAt });

      expect(trashed.map((row) => row.id)).toEqual(['own-public']);
      expect(trashed[0].isDeleted).toBe(true);
      expect(trashed[0].deletedAt).toEqual(deletedAt);
    });

    it('softDelete with restrictToCreator skips teammates in a workspace', async () => {
      const owner = new AgentModel(serverDB, userId, workspaceId);

      expect(
        await owner.softDelete(['ws-member-public'], { deletedAt, restrictToCreator: true }),
      ).toEqual([]);
      expect(
        (await owner.softDelete(['ws-member-public'], { deletedAt })).map((row) => row.id),
      ).toEqual(['ws-member-public']);
    });

    it('hasTrashedOwner follows the agent id or the legacy session link', async () => {
      const model = new AgentModel(serverDB, userId);

      expect(await model.hasTrashedOwner({})).toBe(false);
      expect(await model.hasTrashedOwner({ agentId: 'own-public' })).toBe(false);

      await model.softDelete(['own-public'], { deletedAt });

      expect(await model.hasTrashedOwner({ agentId: 'own-public' })).toBe(true);
      expect(await model.hasTrashedOwner({ sessionId: 'own-session' })).toBe(true);
      expect(await model.hasTrashedOwner({ agentId: null, sessionId: null })).toBe(false);
    });

    it('findTrashedByIds / lockTrashedForPurge / restore / purge only touch trashed owned rows', async () => {
      const model = new AgentModel(serverDB, userId);
      await model.softDelete(['own-public', 'own-private'], { deletedAt });

      expect(await model.findTrashedByIds([])).toEqual([]);
      expect(
        (await model.findTrashedByIds(['own-public', 'foreign'])).map((row) => row.id),
      ).toEqual(['own-public']);
      expect(await model.lockTrashedForPurge([])).toEqual([]);
      expect(
        await serverDB.transaction(async (tx) =>
          new AgentModel(tx as unknown as LobeChatDatabase, userId).lockTrashedForPurge([
            'own-private',
            'foreign',
          ]),
        ),
      ).toEqual(['own-private']);

      expect(await model.restore([])).toEqual([]);
      expect((await model.restore(['own-private', 'foreign'])).map((row) => row.id)).toEqual([
        'own-private',
      ]);
      expect((await model.findTrashedByIds(['own-private'])).length).toBe(0);

      expect(await model.purge([])).toEqual([]);
      expect(await model.purge(['own-public', 'own-private', 'foreign'])).toEqual(['own-public']);
      expect(await liveIds()).toEqual([
        'foreign',
        'own-private',
        'ws-member-private',
        'ws-member-public',
      ]);
      const links = await serverDB
        .select({ agentId: agentsToSessions.agentId })
        .from(agentsToSessions)
        .where(eq(agentsToSessions.sessionId, 'own-session'));
      expect(links).toEqual([]);
    });
  });

  describe('assertDeletable', () => {
    it('passes with no pending job, with or without a transaction', async () => {
      const model = new AgentModel(serverDB, userId);

      await expect(model.assertDeletable([])).resolves.toBeUndefined();
      await expect(model.assertDeletable(['own-public'])).resolves.toBeUndefined();
      await expect(
        serverDB.transaction((tx) => model.assertDeletable(['own-public'], tx)),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['a pending transfer job', 'transfer', AGENT_TRANSFER_IN_PROGRESS],
      ['a pending transfer remap', 'remap', AGENT_TRANSFER_IN_PROGRESS],
      ['a pending copy job', 'copy', AGENT_COPY_IN_PROGRESS],
    ] as const)('rejects while there is %s', async (_name, kind, message) => {
      vi.spyOn(AgentTransferJobModel, 'hasPendingJobForAgents').mockResolvedValue(
        kind === 'transfer',
      );
      vi.spyOn(AgentTransferJobModel, 'hasPendingRemapForSourceAgents').mockResolvedValue(
        kind === 'remap',
      );
      vi.spyOn(AgentCopyJobModel, 'hasPendingCopyJobForSourceAgents').mockResolvedValue(
        kind === 'copy',
      );
      const model = new AgentModel(serverDB, userId);

      await expect(model.assertDeletable(['own-public'])).rejects.toThrow(message);
    });
  });
});
