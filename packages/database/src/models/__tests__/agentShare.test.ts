// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { AgentShareConfig } from '../../schemas';
import { agents, agentShares, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-share-test-user';
const otherUserId = 'agent-share-test-other-user';
const agentId = 'agent-share-test-agent';
const otherAgentId = 'agent-share-test-other-agent';
const workspaceAgentId = 'agent-share-test-workspace-agent';
const workspaceId = 'agent-share-test-workspace';

const agentShareModel = new AgentShareModel(serverDB, userId);
const otherAgentShareModel = new AgentShareModel(serverDB, otherUserId);

describe('AgentShareModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: otherUserId }]);
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: 'Agent Share Test Workspace',
        primaryOwnerId: userId,
        slug: 'agent-share-test-workspace',
      });
      await tx.insert(agents).values([
        {
          avatar: '🤯',
          backgroundColor: '#000000',
          description: 'Shareable agent',
          id: agentId,
          name: 'Shareable Agent',
          title: 'Shareable Agent Title',
          userId,
        },
        { id: otherAgentId, title: 'Other Agent', userId: otherUserId },
        { id: workspaceAgentId, userId, workspaceId },
      ]);
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('create', () => {
    it('creates a share with conservative defaults', async () => {
      const share = await agentShareModel.create(agentId);

      expect(share).not.toBeNull();
      expect(share).toMatchObject({
        agentId,
        shareConfig: {
          allowCreatorViewSessions: false,
          allowReadMemory: false,
          maxTopicsPerVisitor: 5,
          maxTurnsPerTopic: 20,
          showErrorDetails: false,
          showModelInfo: false,
          toolGrants: [],
        },
        userViewCount: 0,
        visibility: 'private',
      });
      expect(share!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(share!.shareConfig).not.toHaveProperty('guestEnabled');
      expect(share!.shareConfig).not.toHaveProperty('maxGuestTopics');
      expect(share!.shareConfig).not.toHaveProperty('filePermissionConfig');
    });

    it('preserves the first share when creation conflicts', async () => {
      const first = await agentShareModel.create(agentId, 'private');
      const second = await agentShareModel.create(agentId, 'link');

      expect(second).toEqual(first);
      const rows = await serverDB
        .select()
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId));
      expect(rows).toHaveLength(1);
      expect(rows[0].visibility).toBe('private');
    });

    it('rejects missing, foreign, and workspace agents', async () => {
      await expect(agentShareModel.create('missing-agent')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(agentShareModel.create(otherAgentId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(agentShareModel.create(workspaceAgentId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('owner operations', () => {
    it('normalizes a legacy null config to conservative defaults', async () => {
      const [legacyShare] = await serverDB.insert(agentShares).values({ agentId }).returning();

      const ownerShare = await agentShareModel.getByAgentId(agentId);
      const resolvedShare = await AgentShareModel.findByShareId(serverDB, legacyShare.id);

      expect(ownerShare?.shareConfig).toEqual({
        allowCreatorViewSessions: false,
        allowReadMemory: false,
        maxTopicsPerVisitor: 5,
        maxTurnsPerTopic: 20,
        monthlySpendLimit: 10,
        showErrorDetails: false,
        showModelInfo: false,
        slug: undefined,
        toolGrants: [],
      });
      expect(resolvedShare?.shareConfig).toEqual(ownerShare?.shareConfig);
    });

    it('reads and updates the complete config', async () => {
      await agentShareModel.create(agentId);
      const config: AgentShareConfig = {
        allowCreatorViewSessions: true,
        allowReadMemory: true,
        maxTopicsPerVisitor: 10,
        maxTurnsPerTopic: 40,
        monthlySpendLimit: 25,
        showErrorDetails: true,
        showModelInfo: true,
        toolGrants: [{ identifier: 'search' }],
      };

      const updated = await agentShareModel.updateConfig(agentId, config);
      const readBack = await agentShareModel.getByAgentId(agentId);

      expect(updated?.shareConfig).toEqual(config);
      expect(readBack?.shareConfig).toEqual(config);
    });

    it('atomically merges stale cross-context patches without losing sibling fields', async () => {
      await agentShareModel.create(agentId);

      await agentShareModel.updateConfig(agentId, {
        maxTopicsPerVisitor: 10,
        toolGrants: [{ identifier: 'search' }],
      });
      const updated = await agentShareModel.updateConfig(agentId, {
        maxTurnsPerTopic: 40,
        showModelInfo: true,
      });

      expect(updated?.shareConfig).toMatchObject({
        maxTopicsPerVisitor: 10,
        maxTurnsPerTopic: 40,
        showModelInfo: true,
        toolGrants: [{ identifier: 'search' }],
      });
    });

    it('overwrites the spend cap, and never accepts slug via updateConfig', async () => {
      await agentShareModel.create(agentId);
      await agentShareModel.updateConfig(agentId, { monthlySpendLimit: 25 });

      const updated = await agentShareModel.updateConfig(agentId, {
        monthlySpendLimit: 0,
        showModelInfo: true,
        // smuggled past the type on purpose — must be stripped, not persisted
        ...({ slug: 'sneaky-slug' } as object),
      });

      // `0` is a real cap ("stop all visitor runs"), never a cleared one.
      expect(updated?.shareConfig.monthlySpendLimit).toBe(0);
      expect(updated?.shareConfig.showModelInfo).toBe(true);
      expect(updated?.shareConfig.slug).toBeUndefined();
      expect(await AgentShareModel.findBySlugOrId(serverDB, 'sneaky-slug')).toBeNull();
    });

    // `deleteByAgentId` is the hard-teardown path, deliberately NOT what the
    // disable flow uses (see the cycle test below).
    it('updates visibility, and hard-deletes the share on demand', async () => {
      const created = await agentShareModel.create(agentId);

      const updated = await agentShareModel.updateVisibility(agentId, 'link');
      expect(updated?.visibility).toBe('link');

      const deleted = await agentShareModel.deleteByAgentId(agentId);
      expect(deleted?.id).toBe(created?.id);
      expect(await AgentShareModel.findByShareId(serverDB, created!.id)).toBeNull();
    });

    it('returns null for missing shares', async () => {
      expect(await agentShareModel.getByAgentId(agentId)).toBeNull();
      expect(await agentShareModel.updateConfig(agentId, { maxTopicsPerVisitor: 5 })).toBeNull();
      expect(await agentShareModel.updateVisibility(agentId, 'link')).toBeNull();
      expect(await agentShareModel.deleteByAgentId(agentId)).toBeNull();
    });

    it("does not read, update, or delete another user's share", async () => {
      const otherShare = await otherAgentShareModel.create(otherAgentId);

      expect(await agentShareModel.getByAgentId(otherAgentId)).toBeNull();
      expect(
        await agentShareModel.updateConfig(otherAgentId, { maxTopicsPerVisitor: 5 }),
      ).toBeNull();
      expect(await agentShareModel.updateVisibility(otherAgentId, 'link')).toBeNull();
      expect(await agentShareModel.deleteByAgentId(otherAgentId)).toBeNull();
      expect(await otherAgentShareModel.getByAgentId(otherAgentId)).toEqual(otherShare);
    });

    // Turning sharing off is a pause, not a revocation — `updateVisibility`,
    // never a delete — so the link (share id + custom slug) survives the cycle
    // and re-enabling republishes the very same url.
    it('keeps the share id and slug across a disable → re-enable cycle', async () => {
      const first = await agentShareModel.create(agentId, 'link');
      await agentShareModel.updateSlug(agentId, 'stable-link');

      const disabled = await agentShareModel.updateVisibility(agentId, 'private');
      expect(disabled?.id).toBe(first?.id);
      expect(disabled?.shareConfig.slug).toBe('stable-link');

      // `create` falls back to the existing row rather than inserting a new one.
      const recreated = await agentShareModel.create(agentId, 'link');
      const reEnabled = await agentShareModel.updateVisibility(agentId, 'link');

      expect(recreated?.id).toBe(first?.id);
      expect(reEnabled?.id).toBe(first?.id);
      expect(reEnabled?.shareConfig.slug).toBe('stable-link');
      expect(await AgentShareModel.findByShareId(serverDB, first!.id)).not.toBeNull();
      expect(await AgentShareModel.findBySlugOrId(serverDB, 'stable-link')).not.toBeNull();
    });
  });

  describe('updateSlug', () => {
    it('persists a valid custom slug', async () => {
      await agentShareModel.create(agentId);

      const updated = await agentShareModel.updateSlug(agentId, 'my-cool-bot');

      expect(updated?.shareConfig.slug).toBe('my-cool-bot');
      expect((await agentShareModel.getByAgentId(agentId))?.shareConfig.slug).toBe('my-cool-bot');
    });

    it('clears the custom slug with null', async () => {
      await agentShareModel.create(agentId);
      await agentShareModel.updateSlug(agentId, 'short-lived');

      const cleared = await agentShareModel.updateSlug(agentId, null);

      expect(cleared?.shareConfig.slug).toBeUndefined();
      expect(await AgentShareModel.findBySlugOrId(serverDB, 'short-lived')).toBeNull();
    });

    it.each([
      ['single char', 'a'],
      ['too short', 'ab'],
      ['uppercase', 'My-Bot'],
      ['leading hyphen', '-my-bot'],
      ['trailing hyphen', 'my-bot-'],
      ['underscore', 'my_bot'],
      ['uuid-shaped (unreachable: id lookup wins)', '01234567-89ab-4cde-8f01-23456789abcd'],
    ])('rejects an invalid slug (%s)', async (_label, slug) => {
      await agentShareModel.create(agentId);

      await expect(agentShareModel.updateSlug(agentId, slug)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('rejects a reserved slug', async () => {
      await agentShareModel.create(agentId);

      await expect(agentShareModel.updateSlug(agentId, 'settings')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('rejects a slug already taken by another share', async () => {
      await agentShareModel.create(agentId);
      await otherAgentShareModel.create(otherAgentId);
      await agentShareModel.updateSlug(agentId, 'taken-slug');

      await expect(
        otherAgentShareModel.updateSlug(otherAgentId, 'taken-slug'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('allows re-setting the same slug on the same share', async () => {
      await agentShareModel.create(agentId);
      await agentShareModel.updateSlug(agentId, 'stable-slug');

      await expect(agentShareModel.updateSlug(agentId, 'stable-slug')).resolves.toMatchObject({
        shareConfig: { slug: 'stable-slug' },
      });
    });

    it('resolves to null (not a share) for missing, foreign, or workspace agents', async () => {
      // Ownership resolution runs through the same `withOwnedPersonalAgentLock`
      // helper `updateConfig`/`updateVisibility` use, so an unowned/missing
      // agent resolves to `null` here too — the router's `requireShare` is what
      // turns that into a `NOT_FOUND` for the caller.
      expect(await agentShareModel.updateSlug('missing-agent', 'foo-bar')).toBeNull();
      expect(await agentShareModel.updateSlug(otherAgentId, 'foo-bar')).toBeNull();
      expect(await agentShareModel.updateSlug(workspaceAgentId, 'foo-bar')).toBeNull();
    });
  });

  describe('findBySlugOrId', () => {
    it('resolves a share by its custom slug', async () => {
      const created = await agentShareModel.create(agentId, 'link');
      await agentShareModel.updateSlug(agentId, 'find-me');

      const share = await AgentShareModel.findBySlugOrId(serverDB, 'find-me');

      expect(share?.shareId).toBe(created!.id);
    });

    it('resolves a slug case-insensitively (stored slugs are lowercase)', async () => {
      const created = await agentShareModel.create(agentId, 'link');
      await agentShareModel.updateSlug(agentId, 'find-me');

      const share = await AgentShareModel.findBySlugOrId(serverDB, 'FIND-Me');

      expect(share?.shareId).toBe(created!.id);
    });

    it('resolves a share by its UUID id', async () => {
      const created = await agentShareModel.create(agentId, 'link');

      const share = await AgentShareModel.findBySlugOrId(serverDB, created!.id);

      expect(share?.shareId).toBe(created!.id);
    });

    it('resolves a share of any visibility (access check is the caller’s job)', async () => {
      const created = await agentShareModel.create(agentId, 'private');
      await agentShareModel.updateSlug(agentId, 'private-slug');

      const share = await AgentShareModel.findBySlugOrId(serverDB, 'private-slug');

      expect(share?.shareId).toBe(created!.id);
      expect(share?.visibility).toBe('private');
    });

    it('returns null for an unknown slug', async () => {
      expect(await AgentShareModel.findBySlugOrId(serverDB, 'no-such-slug')).toBeNull();
    });

    it('returns null for an unknown UUID', async () => {
      expect(
        await AgentShareModel.findBySlugOrId(serverDB, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });
  });

  describe('public lookup', () => {
    it('returns the minimum public agent metadata', async () => {
      const created = await agentShareModel.create(agentId, 'link');

      const share = await AgentShareModel.findByShareId(serverDB, created!.id);

      expect(share).toMatchObject({
        agentBackgroundColor: '#000000',
        agentDescription: 'Shareable agent',
        agentId,
        agentName: 'Shareable Agent',
        agentTitle: 'Shareable Agent Title',
        ownerId: userId,
        shareConfig: expect.objectContaining({
          maxTopicsPerVisitor: 5,
          maxTurnsPerTopic: 20,
        }),
        shareId: created!.id,
        visibility: 'link',
      });
    });

    it('does not expose a workspace agent even if a share row exists', async () => {
      const [share] = await serverDB
        .insert(agentShares)
        .values({
          agentId: workspaceAgentId,
          shareConfig: { maxTopicsPerVisitor: 5, maxTurnsPerTopic: 20 },
          visibility: 'link',
        })
        .returning();

      expect(await AgentShareModel.findByShareId(serverDB, share.id)).toBeNull();
    });

    it('returns null for an unknown UUID', async () => {
      expect(
        await AgentShareModel.findByShareId(serverDB, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });

    it('treats a malformed UUID as not found', async () => {
      expect(await AgentShareModel.findByShareId(serverDB, 'not-a-uuid')).toBeNull();
      await expect(
        AgentShareModel.findByShareIdWithAccessCheck(serverDB, 'not-a-uuid', userId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('access checks', () => {
    it('allows the owner to access a private share', async () => {
      const created = await agentShareModel.create(agentId);

      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        serverDB,
        created!.id,
        userId,
      );

      expect(share.shareId).toBe(created!.id);
    });

    // NOT_FOUND rather than FORBIDDEN so a stranger cannot tell a paused share
    // from a non-existent one.
    it('hides a private share from non-owners as NOT_FOUND', async () => {
      const created = await agentShareModel.create(agentId);

      await expect(
        AgentShareModel.findByShareIdWithAccessCheck(serverDB, created!.id, otherUserId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Share not found' });
    });

    it('allows authenticated access to a link share', async () => {
      const created = await agentShareModel.create(agentId, 'link');

      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        serverDB,
        created!.id,
        otherUserId,
      );

      expect(share.shareId).toBe(created!.id);
    });

    it('throws NOT_FOUND for an unknown UUID', async () => {
      await expect(
        AgentShareModel.findByShareIdWithAccessCheck(
          serverDB,
          '00000000-0000-0000-0000-000000000000',
          userId,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('isRunStillAuthorized', () => {
    it('authorizes a live link share on a personal agent', async () => {
      const created = await agentShareModel.create(agentId, 'link');

      expect(
        await AgentShareModel.isRunStillAuthorized(serverDB, { agentId, shareId: created!.id }),
      ).toBe(true);
    });

    it('revokes once the share is paused or replaced', async () => {
      const created = await agentShareModel.create(agentId, 'link');

      await agentShareModel.updateVisibility(agentId, 'private');
      expect(
        await AgentShareModel.isRunStillAuthorized(serverDB, { agentId, shareId: created!.id }),
      ).toBe(false);

      await agentShareModel.updateVisibility(agentId, 'link');
      expect(
        await AgentShareModel.isRunStillAuthorized(serverDB, {
          agentId,
          shareId: '00000000-0000-0000-0000-000000000000',
        }),
      ).toBe(false);
    });

    // `transferAgent` does not touch `agent_shares`; the per-step check must
    // notice the agent left personal scope on its own, like `findByShareId`.
    it('revokes an in-flight run once the agent is moved into a workspace', async () => {
      const created = await agentShareModel.create(agentId, 'link');
      await serverDB.update(agents).set({ workspaceId }).where(eq(agents.id, agentId));

      expect(
        await AgentShareModel.isRunStillAuthorized(serverDB, { agentId, shareId: created!.id }),
      ).toBe(false);
    });
  });

  describe('readCurrentVisitorCaps', () => {
    it('reads fresh caps and the live shareId', async () => {
      const created = await agentShareModel.create(agentId);
      await agentShareModel.updateConfig(agentId, {
        maxTopicsPerVisitor: 3,
        maxTurnsPerTopic: 8,
        monthlySpendLimit: 2.5,
      });

      await expect(AgentShareModel.readCurrentVisitorCaps(serverDB, agentId)).resolves.toEqual({
        maxTopicsPerVisitor: 3,
        maxTurnsPerTopic: 8,
        monthlySpendLimit: 2.5,
        shareId: created!.id,
      });
    });

    it('falls back to defaults and a null shareId when there is no share', async () => {
      await expect(AgentShareModel.readCurrentVisitorCaps(serverDB, agentId)).resolves.toEqual({
        maxTopicsPerVisitor: 5,
        maxTurnsPerTopic: 20,
        monthlySpendLimit: 10,
        shareId: null,
      });
    });
  });

  describe('incrementUserViewCount', () => {
    it('atomically records successful page views', async () => {
      const created = await agentShareModel.create(agentId);

      await Promise.all([
        AgentShareModel.incrementUserViewCount(serverDB, created!.id),
        AgentShareModel.incrementUserViewCount(serverDB, created!.id),
        AgentShareModel.incrementUserViewCount(serverDB, created!.id),
      ]);

      const [share] = await serverDB
        .select({ userViewCount: agentShares.userViewCount })
        .from(agentShares)
        .where(eq(agentShares.id, created!.id));
      expect(share.userViewCount).toBe(3);
    });
  });
});
