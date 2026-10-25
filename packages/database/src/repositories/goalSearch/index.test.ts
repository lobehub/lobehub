// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goals, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalSearchRepo } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-search-user';
const otherUserId = 'goal-search-other-user';
const workspaceId = 'ws_goal_search';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const insertGoal = (values: Partial<typeof goals.$inferInsert> & { id: string; title: string }) =>
  serverDB.insert(goals).values({ userId, ...values });

describe('GoalSearchRepo', () => {
  it('finds goals by title or requirement, ranking title matches first', async () => {
    await insertGoal({
      id: 'goal_req',
      requirement: 'Prove the STAMP loop on a second domain',
      title: 'Second domain rollout',
    });
    await insertGoal({ id: 'goal_title', status: 'paused', title: 'Replica migration (STAMP)' });
    await insertGoal({ id: 'goal_miss', title: 'Unrelated' });

    const results = await new GoalSearchRepo(serverDB, userId).search({ query: 'stamp' });

    expect(results.map(({ id }) => id)).toEqual(['goal_title', 'goal_req']);
    expect(results[0]).toMatchObject({
      relevance: 3,
      status: 'paused',
      title: 'Replica migration (STAMP)',
      type: 'goal',
    });
    expect(results[1].description).toBe('Prove the STAMP loop on a second domain');
  });

  it('keeps goals whose lifetime overlaps the window', async () => {
    const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    await insertGoal({
      completedAt: at('2026-09-05'),
      createdAt: at('2026-09-01'),
      id: 'goal_finished_before',
      status: 'achieved',
      title: 'replica finished before',
      updatedAt: at('2026-09-05'),
    });
    await insertGoal({
      // Still open and not edited since September: active the whole window.
      createdAt: at('2026-09-01'),
      id: 'goal_open_untouched',
      status: 'paused',
      title: 'replica open untouched',
      updatedAt: at('2026-09-05'),
    });
    await insertGoal({
      // Edited after it finished: the edit must not extend its lifetime.
      completedAt: at('2026-09-10'),
      createdAt: at('2026-09-01'),
      id: 'goal_finished_edited_later',
      status: 'canceled',
      title: 'replica finished edited later',
      updatedAt: at('2026-10-15'),
    });
    await insertGoal({
      completedAt: at('2026-10-14'),
      createdAt: at('2026-10-01'),
      id: 'goal_finished_inside',
      status: 'achieved',
      title: 'replica finished inside',
      updatedAt: at('2026-10-14'),
    });
    await insertGoal({
      // Terminal row that predates `completedAt`: falls back to its last update.
      createdAt: at('2026-08-01'),
      id: 'goal_legacy_terminal',
      status: 'failed',
      title: 'replica legacy terminal',
      updatedAt: at('2026-08-05'),
    });
    await insertGoal({
      createdAt: at('2026-10-20'),
      id: 'goal_future',
      title: 'replica future',
      updatedAt: at('2026-10-21'),
    });

    const results = await new GoalSearchRepo(serverDB, userId).search({
      endDate: new Date('2026-10-18T23:59:59.000Z'),
      limit: 10,
      query: 'replica',
      startDate: at('2026-10-12'),
    });

    expect(results.map(({ id }) => id).sort()).toEqual([
      'goal_finished_inside',
      'goal_open_untouched',
    ]);
  });

  it('never returns other users, other scopes or trashed goals', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Workspace',
      primaryOwnerId: userId,
      slug: 'goal-search-ws',
    });
    await insertGoal({ id: 'goal_own', title: 'harvest farm' });
    await insertGoal({ id: 'goal_other', title: 'harvest farm', userId: otherUserId });
    await insertGoal({ id: 'goal_ws', title: 'harvest farm', workspaceId });
    await insertGoal({ id: 'goal_trashed', isDeleted: true, title: 'harvest farm' });

    const personal = await new GoalSearchRepo(serverDB, userId).search({ query: 'harvest' });
    expect(personal.map(({ id }) => id)).toEqual(['goal_own']);

    const workspace = await new GoalSearchRepo(serverDB, userId, workspaceId).search({
      query: 'harvest',
    });
    expect(workspace.map(({ id }) => id)).toEqual(['goal_ws']);
  });

  it('returns nothing for a blank query or non-positive limit', async () => {
    await insertGoal({ id: 'goal_any', title: 'anything' });
    const repo = new GoalSearchRepo(serverDB, userId);

    expect(await repo.search({ query: '  ' })).toEqual([]);
    expect(await repo.search({ limit: 0, query: 'anything' })).toEqual([]);
  });
});
