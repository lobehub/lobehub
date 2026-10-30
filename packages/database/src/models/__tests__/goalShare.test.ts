// @vitest-environment node
import type { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goals, goalShares, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalShareModel } from '../goalShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-share-test-user-id';
const userId2 = 'goal-share-test-user-id-2';
const goalId = 'goal-share-test-goal';
const goalId2User2 = 'goal-share-test-goal-user2';

const shareModel = new GoalShareModel(serverDB, userId);
const shareModelOther = new GoalShareModel(serverDB, userId2);

const expectTRPCCode = async (promise: Promise<unknown>, code: TRPCError['code']) => {
  await expect(promise).rejects.toMatchObject({ code });
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
  await serverDB.insert(goals).values([
    { id: goalId, title: 'Goal 1', userId },
    { id: goalId2User2, title: 'Goal 2', userId: userId2 },
  ]);
});

afterEach(async () => {
  await serverDB.delete(goalShares);
  await serverDB.delete(goals);
  await serverDB.delete(users);
});

describe('GoalShareModel', () => {
  describe('create', () => {
    it('creates a private share owned by the goal creator by default', async () => {
      const result = await shareModel.create(goalId);

      expect(result).toMatchObject({ goalId, userId, visibility: 'private' });
      expect(result!.id).toHaveLength(16);
    });

    it('creates a link share', async () => {
      const result = await shareModel.create(goalId, 'link');
      expect(result!.visibility).toBe('link');
    });

    it('throws when the goal does not exist', async () => {
      await expect(shareModel.create('missing')).rejects.toThrow(
        'Goal not found or not owned by user',
      );
    });

    it('throws when the goal belongs to another user', async () => {
      await expect(shareModel.create(goalId2User2)).rejects.toThrow(
        'Goal not found or not owned by user',
      );
    });

    it('returns the existing share on duplicate create', async () => {
      const first = await shareModel.create(goalId, 'link');
      const second = await shareModel.create(goalId);

      expect(second!.id).toBe(first!.id);
      expect(second!.visibility).toBe('link');
    });
  });

  describe('updateVisibility', () => {
    it('updates the visibility of an own share', async () => {
      await shareModel.create(goalId);

      const updated = await shareModel.updateVisibility(goalId, 'link');
      expect(updated!.visibility).toBe('link');
    });

    it('returns null when no share exists', async () => {
      expect(await shareModel.updateVisibility(goalId, 'link')).toBeNull();
    });

    it('does not change another user share', async () => {
      await shareModel.create(goalId);

      expect(await shareModelOther.updateVisibility(goalId, 'link')).toBeNull();
      expect((await shareModel.getByGoalId(goalId))!.visibility).toBe('private');
    });
  });

  describe('deleteByGoalId', () => {
    it('deletes an own share', async () => {
      await shareModel.create(goalId);
      await shareModel.deleteByGoalId(goalId);

      expect(await shareModel.getByGoalId(goalId)).toBeNull();
    });

    it('does not delete another user share', async () => {
      await shareModel.create(goalId);
      await shareModelOther.deleteByGoalId(goalId);

      expect(await shareModel.getByGoalId(goalId)).not.toBeNull();
    });
  });

  describe('getByGoalId', () => {
    it('returns the share for its owner', async () => {
      const created = await shareModel.create(goalId, 'link');

      expect(await shareModel.getByGoalId(goalId)).toMatchObject({
        goalId,
        id: created!.id,
        pageViewCount: 0,
        visibility: 'link',
      });
    });

    it('does not leak the share to another user', async () => {
      await shareModel.create(goalId, 'link');
      expect(await shareModelOther.getByGoalId(goalId)).toBeNull();
    });
  });

  describe('findByShareIdWithAccessCheck (static)', () => {
    it('lets the owner read a private share', async () => {
      const share = await shareModel.create(goalId);

      const result = await GoalShareModel.findByShareIdWithAccessCheck(serverDB, share!.id, userId);
      expect(result).toMatchObject({ goalId, ownerId: userId, title: 'Goal 1' });
    });

    it('rejects anyone else for a private share', async () => {
      const share = await shareModel.create(goalId);

      await expectTRPCCode(
        GoalShareModel.findByShareIdWithAccessCheck(serverDB, share!.id, userId2),
        'FORBIDDEN',
      );
      await expectTRPCCode(
        GoalShareModel.findByShareIdWithAccessCheck(serverDB, share!.id),
        'FORBIDDEN',
      );
    });

    it('lets an anonymous viewer read a link share', async () => {
      const share = await shareModel.create(goalId, 'link');

      const result = await GoalShareModel.findByShareIdWithAccessCheck(serverDB, share!.id);
      expect(result.goalId).toBe(goalId);
    });

    it('throws NOT_FOUND for an unknown share id', async () => {
      await expectTRPCCode(
        GoalShareModel.findByShareIdWithAccessCheck(serverDB, 'missing'),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND once the goal is in the recycle bin', async () => {
      const share = await shareModel.create(goalId, 'link');
      await serverDB
        .update(goals)
        .set({ deletedAt: new Date(), isDeleted: true })
        .where(eq(goals.id, goalId));

      await expectTRPCCode(
        GoalShareModel.findByShareIdWithAccessCheck(serverDB, share!.id),
        'NOT_FOUND',
      );
    });
  });

  describe('incrementViewCount (static)', () => {
    it('increments the page view count', async () => {
      const share = await shareModel.create(goalId, 'link');

      await GoalShareModel.incrementViewCount(serverDB, share!.id);
      await GoalShareModel.incrementViewCount(serverDB, share!.id);

      expect((await shareModel.getByGoalId(goalId))!.pageViewCount).toBe(2);
    });
  });

  it('deletes the share together with its goal', async () => {
    await shareModel.create(goalId);
    await serverDB.delete(goals).where(eq(goals.id, goalId));

    expect(await serverDB.select().from(goalShares)).toHaveLength(0);
  });

  describe('workspace mode', () => {
    const workspaceId = 'goal-share-ws';
    const wsGoalId = 'goal-share-ws-goal';
    let wsShareModel: GoalShareModel;

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Goal Share WS',
        primaryOwnerId: userId,
        slug: 'goal-share-ws',
      });
      await serverDB.insert(goals).values({ id: wsGoalId, title: 'WS Goal', userId, workspaceId });
      wsShareModel = new GoalShareModel(serverDB, userId, workspaceId);
    });

    it('scopes the share to the workspace', async () => {
      const share = await wsShareModel.create(wsGoalId);
      expect(share!.workspaceId).toBe(workspaceId);
    });

    it('still finds the share after switching visibility to link', async () => {
      await wsShareModel.create(wsGoalId);
      await wsShareModel.updateVisibility(wsGoalId, 'link');

      // goal_shares.visibility is share semantics ('private' | 'link') and must
      // not be fed into the workspace row-visibility filter.
      expect((await wsShareModel.getByGoalId(wsGoalId))!.visibility).toBe('link');
    });

    it('does not see the workspace share from personal scope', async () => {
      await wsShareModel.create(wsGoalId);
      expect(await shareModel.getByGoalId(wsGoalId)).toBeNull();
    });
  });
});
