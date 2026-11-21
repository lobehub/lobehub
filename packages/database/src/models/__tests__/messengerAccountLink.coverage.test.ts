// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, messengerAccountLinks, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  MessengerAccountLinkConflictError,
  MessengerAccountLinkModel,
  MessengerAccountLinkRelinkRequiredError,
} from '../messengerAccountLink';

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 't863-msg-user-a';
const userB = 't863-msg-user-b';
const ghostUser = 't863-msg-ghost';
const agentA = 't863-msg-agent-a';
const workspaceA = 't863-msg-workspace-a';
const platform = 't863-msg-link';
const tenantId = 'tenant-1';
const missingId = '00000000-0000-4000-8000-000000000863';

const APPLICATION_UNIQUE_CONSTRAINT = 'messenger_account_links_platform_tenant_application_unique';

const modelA = new MessengerAccountLinkModel(serverDB, userA);
const modelB = new MessengerAccountLinkModel(serverDB, userB);

/** Seeds the row the races below start from: user A bound to `u1` in `(platform, tenant-1)`. */
const seedOwnLink = (extra: Partial<typeof messengerAccountLinks.$inferInsert> = {}) =>
  serverDB
    .insert(messengerAccountLinks)
    .values({ platform, platformUserId: 'u1', tenantId, userId: userA, ...extra })
    .returning()
    .then(([row]) => row);

/**
 * Simulates a concurrent unlink + relink: the identity lookup ran before the row reappeared, so
 * it misses, while the later `(user, platform, tenant)` lookup sees the row.
 */
/** Postgres error code, wherever the driver/ORM put it. */
const pgCode = (error: unknown) => {
  const e = error as { cause?: { code?: string }; code?: string };
  return e.cause?.code ?? e.code;
};

const missIdentityLookupOnce = () =>
  vi.spyOn(MessengerAccountLinkModel, 'findByPlatformUser').mockResolvedValueOnce(undefined);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
  await serverDB.insert(workspaces).values({
    id: workspaceA,
    name: 'T863 Workspace',
    primaryOwnerId: userA,
    slug: 't863-msg-workspace-a',
  });
  await serverDB.insert(agents).values({ id: agentA, userId: userA });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(messengerAccountLinks).where(eq(messengerAccountLinks.platform, platform));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceA));
  // Agents and links cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userA, userB]));
});

describe('MessengerAccountLinkModel coverage', () => {
  describe('upsertForPlatform insert path', () => {
    it('rethrows a non-unique insert failure untouched', async () => {
      const ghost = new MessengerAccountLinkModel(serverDB, ghostUser);

      const error = await ghost
        .upsertForPlatform({ platform, platformUserId: 'ghost', tenantId })
        .catch((e) => e);

      // Foreign-key violation on `user_id`, not mapped to a typed link error.
      expect(pgCode(error)).toBe('23503');
      await expect(
        serverDB
          .select()
          .from(messengerAccountLinks)
          .where(eq(messengerAccountLinks.userId, ghostUser)),
      ).resolves.toEqual([]);
    });

    it('resolves a unique violation on the identity index by its owner', async () => {
      await serverDB
        .insert(messengerAccountLinks)
        .values({ platform, platformUserId: 'shared', tenantId, userId: userB });

      const error = await modelA
        .upsertForPlatform({ platform, platformUserId: 'shared', tenantId })
        .catch((e) => e);

      expect(error).toBeInstanceOf(MessengerAccountLinkConflictError);
      expect(error.existingUserId).toBe(userB);
    });

    it('asks for a relink when the claimed application row is gone (driver-level error)', async () => {
      // node-postgres raises the diagnostics on the error itself, without a `cause` wrapper.
      const driverError = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: APPLICATION_UNIQUE_CONSTRAINT,
      });
      vi.spyOn(serverDB, 'insert').mockImplementationOnce(() => {
        throw driverError;
      });

      await expect(
        modelA.upsertForPlatform({
          applicationId: 'bot-vanished',
          platform,
          platformUserId: 'u-new',
          tenantId,
        }),
      ).rejects.toBeInstanceOf(MessengerAccountLinkRelinkRequiredError);
    });

    it('asks for a relink when the claimed application belongs to the same user', async () => {
      await seedOwnLink({ applicationId: 'bot-own' });
      vi.spyOn(serverDB, 'insert').mockImplementationOnce(() => {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: APPLICATION_UNIQUE_CONSTRAINT,
        });
      });

      await expect(
        modelA.upsertForPlatform({
          applicationId: 'bot-own',
          platform,
          platformUserId: 'u-other',
          tenantId,
        }),
      ).rejects.toBeInstanceOf(MessengerAccountLinkRelinkRequiredError);
    });
  });

  describe('upsertForPlatform identity-resolved update', () => {
    it('rethrows a non-unique update failure', async () => {
      const row = await seedOwnLink();

      const error = await modelA
        .upsertForPlatform({
          activeAgentId: 't863-msg-missing-agent',
          platform,
          platformUserId: 'u1',
          tenantId,
        })
        .catch((e) => e);

      // Foreign-key violation on `active_agent_id`, rethrown as-is.
      expect(pgCode(error)).toBe('23503');

      const [stored] = await serverDB
        .select()
        .from(messengerAccountLinks)
        .where(eq(messengerAccountLinks.id, row.id));
      expect(stored.activeAgentId).toBeNull();
    });
  });

  describe('upsertForPlatform user-scope update (identity lookup raced)', () => {
    it('refreshes every provided field on the user row', async () => {
      const row = await seedOwnLink();
      missIdentityLookupOnce();

      const updated = await modelA.upsertForPlatform({
        activeAgentId: agentA,
        applicationId: 'bot-a',
        credentials: { token: 'rotated' },
        platform,
        platformUserId: 'u1',
        platformUsername: 'alice',
        tenantId,
        workspaceId: workspaceA,
      });

      expect(updated).toMatchObject({
        activeAgentId: agentA,
        applicationId: 'bot-a',
        id: row.id,
        platformUsername: 'alice',
        workspaceId: workspaceA,
      });
      expect(updated).not.toHaveProperty('credentials');
      const withCredentials = await modelA.findByIdWithCredentials(row.id, platform);
      expect(withCredentials?.credentials).toEqual({ token: 'rotated' });
    });

    it('keeps the stored agent, application and credentials when they are omitted', async () => {
      const row = await seedOwnLink({
        activeAgentId: agentA,
        applicationId: 'bot-keep',
        credentials: JSON.stringify({ token: 'kept' }),
        platformUsername: 'old-name',
        workspaceId: workspaceA,
      });
      missIdentityLookupOnce();

      const updated = await modelA.upsertForPlatform({ platform, platformUserId: 'u1', tenantId });

      expect(updated).toMatchObject({
        activeAgentId: agentA,
        applicationId: 'bot-keep',
        id: row.id,
        platformUsername: null,
        workspaceId: null,
      });
      const withCredentials = await modelA.findByIdWithCredentials(row.id, platform);
      expect(withCredentials?.credentials).toEqual({ token: 'kept' });
    });

    it('maps a rotated application id claimed by another user to a conflict', async () => {
      await serverDB.insert(messengerAccountLinks).values({
        applicationId: 'bot-taken',
        platform,
        platformUserId: 'u-b',
        tenantId,
        userId: userB,
      });
      await seedOwnLink();
      missIdentityLookupOnce();

      const error = await modelA
        .upsertForPlatform({ applicationId: 'bot-taken', platform, platformUserId: 'u1', tenantId })
        .catch((e) => e);

      expect(error).toBeInstanceOf(MessengerAccountLinkConflictError);
      expect(error.existingUserId).toBe(userB);
    });

    it('rethrows a non-unique update failure', async () => {
      const row = await seedOwnLink();
      missIdentityLookupOnce();

      const error = await modelA
        .upsertForPlatform({
          activeAgentId: 't863-msg-missing-agent',
          platform,
          platformUserId: 'u1',
          tenantId,
        })
        .catch((e) => e);

      // Foreign-key violation on `active_agent_id`, rethrown as-is.
      expect(pgCode(error)).toBe('23503');

      const [stored] = await serverDB
        .select()
        .from(messengerAccountLinks)
        .where(eq(messengerAccountLinks.id, row.id));
      expect(stored.activeAgentId).toBeNull();
    });

    it('throws when neither lookup finds the row the insert collided with', async () => {
      await seedOwnLink();
      missIdentityLookupOnce();
      vi.spyOn(modelA, 'findByPlatform').mockResolvedValueOnce(undefined);

      await expect(
        modelA.upsertForPlatform({ platform, platformUserId: 'u1', tenantId }),
      ).rejects.toThrow('MessengerAccountLink upsert could not resolve the final row state');
    });
  });

  describe('credential lookups', () => {
    it('findByIdWithCredentials returns undefined for an unknown id', async () => {
      await expect(modelA.findByIdWithCredentials(missingId, platform)).resolves.toBeUndefined();
    });

    it('findByPlatformUserWithCredentials defaults to the global tenant without an application filter', async () => {
      await serverDB.insert(messengerAccountLinks).values({
        applicationId: 'bot-global',
        credentials: JSON.stringify({ token: 'global' }),
        platform,
        platformUserId: 'u-global',
        userId: userB,
      });

      const found = await MessengerAccountLinkModel.findByPlatformUserWithCredentials(serverDB, {
        platform,
        platformUserId: 'u-global',
      });
      const missing = await MessengerAccountLinkModel.findByPlatformUserWithCredentials(serverDB, {
        platform,
        platformUserId: 'u-nobody',
      });

      expect(found).toMatchObject({
        credentials: { token: 'global' },
        tenantId: '',
        userId: userB,
      });
      expect(missing).toBeUndefined();
    });
  });

  it('modelB does not see user A rows', async () => {
    await seedOwnLink();

    await expect(modelB.findByPlatform(platform, tenantId)).resolves.toBeUndefined();
  });
});
