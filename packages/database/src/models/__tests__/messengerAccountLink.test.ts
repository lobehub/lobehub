// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, messengerAccountLinks, users } from '../../schemas';
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

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
  await serverDB.insert(agents).values([
    { id: agentA, userId: userA },
    { id: agentB, userId: userB },
  ]);
});

afterEach(async () => {
  await serverDB.delete(messengerAccountLinks);
  await serverDB.delete(agents);
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

      await model.setActiveAgent('slack', null, 'T_ACME');

      const acme = await model.findByPlatform('slack', 'T_ACME');
      const beta = await model.findByPlatform('slack', 'T_BETA');
      expect(acme?.activeAgentId).toBeNull();
      expect(beta?.activeAgentId).toBe(agentA);
    });
  });
});
