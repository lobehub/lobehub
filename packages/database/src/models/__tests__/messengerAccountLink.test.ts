// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, messengerAccountLinks, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  MessengerAccountLinkConflictError,
  MessengerAccountLinkModel,
  MessengerAccountLinkRelinkRequiredError,
} from '../messengerAccountLink';

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 'msg-link-user-a';
const userB = 'msg-link-user-b';
const agentA = 'msg-link-agent-a';
const agentB = 'msg-link-agent-b';
const workspaceA = 'msg-link-workspace-a';
const workspaceAgentA = 'msg-link-agent-workspace-a';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
  await serverDB.insert(workspaces).values({
    id: workspaceA,
    name: 'Workspace A',
    primaryOwnerId: userA,
    slug: 'workspace-a',
  });
  await serverDB.insert(agents).values([
    { id: agentA, userId: userA },
    { id: agentB, userId: userB },
    { id: workspaceAgentA, userId: userA, workspaceId: workspaceA },
  ]);
});

afterEach(async () => {
  await serverDB.delete(messengerAccountLinks);
  await serverDB.delete(agents);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('MessengerAccountLinkModel', () => {
  describe('upsertForPlatform', () => {
    it('inserts a Telegram row with empty tenant_id (global-bot semantics)', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const row = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: '12345',
        platformUsername: '@alice',
      });

      expect(row.tenantId).toBe('');
      expect(row.platform).toBe('telegram');
    });

    it('inserts Slack rows for the same user under different tenants', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);

      const linkA = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'slack',
        platformUserId: 'U_ALICE',
        tenantId: 'T_ACME',
      });
      const linkB = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'slack',
        platformUserId: 'U_ALICE_OTHER',
        tenantId: 'T_BETA',
      });

      expect(linkA.id).not.toBe(linkB.id);
      expect(linkA.tenantId).toBe('T_ACME');
      expect(linkB.tenantId).toBe('T_BETA');
    });

    it('throws MessengerAccountLinkConflictError when the IM identity is owned by another user', async () => {
      // userB already owns this Telegram identity.
      await new MessengerAccountLinkModel(serverDB, userB).upsertForPlatform({
        activeAgentId: agentB,
        platform: 'telegram',
        platformUserId: 'tg-shared',
      });

      const promise = new MessengerAccountLinkModel(serverDB, userA).upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-shared',
      });

      await expect(promise).rejects.toBeInstanceOf(MessengerAccountLinkConflictError);
      await expect(promise).rejects.toMatchObject({
        code: 'MESSENGER_ACCOUNT_LINK_CONFLICT',
        existingUserId: userB,
      });

      // userB's row must not have been mutated.
      const stillUserB = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        'telegram',
        'tg-shared',
      );
      expect(stillUserB?.userId).toBe(userB);
    });

    it('refreshes (does not duplicate) when the same user re-asserts the same IM identity', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const first = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-1',
        platformUsername: '@old',
      });
      const second = await model.upsertForPlatform({
        platform: 'telegram',
        platformUserId: 'tg-1',
        platformUsername: '@new',
      });

      expect(second.id).toBe(first.id);
      expect(second.platformUsername).toBe('@new');
      // activeAgentId stays since the second call didn't override it.
      expect(second.activeAgentId).toBe(agentA);
    });

    it('throws MessengerAccountLinkRelinkRequiredError when re-linking a different account in the same scope', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const first = await model.upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_OLD',
        tenantId: 'T_ACME',
      });
      const promise = model.upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_NEW',
        tenantId: 'T_ACME',
      });

      await expect(promise).rejects.toBeInstanceOf(MessengerAccountLinkRelinkRequiredError);
      await expect(promise).rejects.toMatchObject({
        code: 'MESSENGER_ACCOUNT_LINK_RELINK_REQUIRED',
      });

      const stillLinked = await model.findByPlatform('slack', 'T_ACME');
      expect(stillLinked?.id).toBe(first.id);
      expect(stillLinked?.platformUserId).toBe('U_OLD');
    });
  });

  describe('findByPlatformUser (static)', () => {
    it('finds the right row when two users share the same Slack user id under different tenants', async () => {
      // Same Slack user id — but in different workspaces, bound to different LobeHub users.
      // (Could happen if two LobeHub accounts both happen to be `U_SHARED` in different workspaces.)
      await new MessengerAccountLinkModel(serverDB, userA).upsertForPlatform({
        activeAgentId: agentA,
        platform: 'slack',
        platformUserId: 'U_SHARED',
        tenantId: 'T_ACME',
      });
      await new MessengerAccountLinkModel(serverDB, userB).upsertForPlatform({
        activeAgentId: agentB,
        platform: 'slack',
        platformUserId: 'U_SHARED',
        tenantId: 'T_BETA',
      });

      const acme = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        'slack',
        'U_SHARED',
        'T_ACME',
      );
      const beta = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        'slack',
        'U_SHARED',
        'T_BETA',
      );

      expect(acme?.userId).toBe(userA);
      expect(beta?.userId).toBe(userB);
    });

    it('defaults to empty tenant_id for backward-compat Telegram callers', async () => {
      await new MessengerAccountLinkModel(serverDB, userA).upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: '12345',
      });

      // Caller that doesn't pass tenantId still resolves the Telegram row.
      const found = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        'telegram',
        '12345',
      );
      expect(found?.userId).toBe(userA);
    });

    it('does not leak across tenants when caller passes a wrong tenant', async () => {
      await new MessengerAccountLinkModel(serverDB, userA).upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_X',
        tenantId: 'T_ACME',
      });
      const wrong = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        'slack',
        'U_X',
        'T_OTHER',
      );
      expect(wrong).toBeUndefined();
    });
  });

  describe('uniqueness invariants', () => {
    it('lets the same user link into two Slack workspaces simultaneously', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      await model.upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_A_IN_ACME',
        tenantId: 'T_ACME',
      });
      await model.upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_A_IN_BETA',
        tenantId: 'T_BETA',
      });
      const links = await model.list();
      expect(links.filter((l) => l.platform === 'slack')).toHaveLength(2);
    });
  });

  describe('active scope (workspaceId)', () => {
    // A given IM identity has exactly one link; `workspaceId` on it is the
    // *active scope* derived from the active agent (personal → null), not part
    // of the link's identity. Switching scope reuses the same row.
    it('persists the active scope passed at upsert time', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const personal = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-scope',
        workspaceId: null,
      });
      expect(personal.workspaceId).toBeNull();

      // Re-asserting the same identity with a workspace agent flips the active
      // scope on the same row — no relink, single identity link.
      const switched = await model.upsertForPlatform({
        activeAgentId: workspaceAgentA,
        platform: 'telegram',
        platformUserId: 'tg-scope',
        workspaceId: workspaceA,
      });
      expect(switched.id).toBe(personal.id);
      expect(switched.workspaceId).toBe(workspaceA);
      expect(switched.activeAgentId).toBe(workspaceAgentA);
    });

    it('setActiveAgent updates both the active agent and the derived scope', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-switch',
        workspaceId: null,
      });

      // Switch into a workspace agent.
      await model.setActiveAgent('telegram', workspaceAgentA, workspaceA);
      let link = await model.findByPlatform('telegram');
      expect(link?.activeAgentId).toBe(workspaceAgentA);
      expect(link?.workspaceId).toBe(workspaceA);

      // Switch back to personal.
      await model.setActiveAgent('telegram', agentA, null);
      link = await model.findByPlatform('telegram');
      expect(link?.activeAgentId).toBe(agentA);
      expect(link?.workspaceId).toBeNull();
    });
  });

  describe('setActiveAgent', () => {
    it('only updates the targeted (platform, tenant) row', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'slack',
        platformUserId: 'U_X',
        tenantId: 'T_ACME',
      });
      await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'slack',
        platformUserId: 'U_Y',
        tenantId: 'T_BETA',
      });

      await model.setActiveAgent('slack', null, null, 'T_ACME');

      const acme = await model.findByPlatform('slack', 'T_ACME');
      const beta = await model.findByPlatform('slack', 'T_BETA');
      expect(acme?.activeAgentId).toBeNull();
      expect(beta?.activeAgentId).toBe(agentA);
    });

    it('returns undefined when there is no matching row', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const updated = await model.setActiveAgent('telegram', agentA, null);
      expect(updated).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('removes the user-owned link by id', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const link = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-del',
      });

      await model.delete(link.id);

      const remaining = await model.list();
      expect(remaining).toHaveLength(0);
    });

    it('does not delete a link owned by another user (ownership scoping)', async () => {
      const ownerB = new MessengerAccountLinkModel(serverDB, userB);
      const link = await ownerB.upsertForPlatform({
        activeAgentId: agentB,
        platform: 'telegram',
        platformUserId: 'tg-owned-by-b',
      });

      // userA tries to delete userB's link by id — ownership() must block it.
      await new MessengerAccountLinkModel(serverDB, userA).delete(link.id);

      const stillThere = await ownerB.findByPlatform('telegram');
      expect(stillThere?.id).toBe(link.id);
    });
  });

  describe('deleteByPlatform', () => {
    it('deletes all of the user links for a platform when no tenant is given', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      await model.upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_IN_ACME',
        tenantId: 'T_ACME',
      });
      await model.upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_IN_BETA',
        tenantId: 'T_BETA',
      });
      await model.upsertForPlatform({
        platform: 'telegram',
        platformUserId: 'tg-keep',
      });

      await model.deleteByPlatform('slack');

      const links = await model.list();
      expect(links).toHaveLength(1);
      expect(links[0].platform).toBe('telegram');
    });

    it('deletes only the targeted tenant row when tenantId is provided', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      await model.upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_IN_ACME',
        tenantId: 'T_ACME',
      });
      await model.upsertForPlatform({
        platform: 'slack',
        platformUserId: 'U_IN_BETA',
        tenantId: 'T_BETA',
      });

      await model.deleteByPlatform('slack', 'T_ACME');

      const acme = await model.findByPlatform('slack', 'T_ACME');
      const beta = await model.findByPlatform('slack', 'T_BETA');
      expect(acme).toBeUndefined();
      expect(beta?.tenantId).toBe('T_BETA');
    });

    it('only deletes the calling user links (ownership scoping)', async () => {
      await new MessengerAccountLinkModel(serverDB, userB).upsertForPlatform({
        activeAgentId: agentB,
        platform: 'telegram',
        platformUserId: 'tg-b',
      });

      // userA has no telegram link; deleting by platform must not touch userB's.
      await new MessengerAccountLinkModel(serverDB, userA).deleteByPlatform('telegram');

      const stillB = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        'telegram',
        'tg-b',
      );
      expect(stillB?.userId).toBe(userB);
    });
  });

  describe('setActiveAgentById (static)', () => {
    it('updates the active agent for the given link id', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const link = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-static-agent',
      });

      const updated = await MessengerAccountLinkModel.setActiveAgentById(
        serverDB,
        link.id,
        workspaceAgentA,
      );
      expect(updated?.activeAgentId).toBe(workspaceAgentA);
      // It only touches activeAgentId — workspaceId (scope) is left as-is.
      expect(updated?.workspaceId).toBe(link.workspaceId);
    });

    it('clears the active agent when passed null', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const link = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-static-clear',
      });

      const updated = await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, null);
      expect(updated?.activeAgentId).toBeNull();
    });

    it('returns undefined for an unknown link id', async () => {
      const updated = await MessengerAccountLinkModel.setActiveAgentById(
        serverDB,
        '00000000-0000-0000-0000-000000000000',
        agentA,
      );
      expect(updated).toBeUndefined();
    });
  });

  describe('setActiveScope (static)', () => {
    it('moves the link to a workspace scope with the provided agent', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const link = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-scope-static',
        workspaceId: null,
      });

      const updated = await MessengerAccountLinkModel.setActiveScope(
        serverDB,
        link.id,
        workspaceA,
        workspaceAgentA,
      );
      expect(updated?.workspaceId).toBe(workspaceA);
      expect(updated?.activeAgentId).toBe(workspaceAgentA);
    });

    it('defaults the agent to null when none is passed (personal scope, no agents)', async () => {
      const model = new MessengerAccountLinkModel(serverDB, userA);
      const link = await model.upsertForPlatform({
        activeAgentId: agentA,
        platform: 'telegram',
        platformUserId: 'tg-scope-default',
        workspaceId: workspaceA,
      });

      const updated = await MessengerAccountLinkModel.setActiveScope(serverDB, link.id, null);
      expect(updated?.workspaceId).toBeNull();
      expect(updated?.activeAgentId).toBeNull();
    });

    it('returns undefined for an unknown link id', async () => {
      const updated = await MessengerAccountLinkModel.setActiveScope(
        serverDB,
        '00000000-0000-0000-0000-000000000000',
        workspaceA,
      );
      expect(updated).toBeUndefined();
    });
  });
});
