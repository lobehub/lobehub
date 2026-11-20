// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, topics, userMemories, userMemoriesContexts, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryConsolidationModel } from '../consolidation';
import { UserMemoryContextStoryModel } from '../contextStory';

const userId = 'context-story-test-user';
const otherUserId = 'context-story-other-user';
const serverDB: LobeChatDatabase = await getTestDB();

const createLegacy = async (title: string, day: string, owner = userId) => {
  const capturedAt = new Date(`${day}T08:00:00.000Z`);
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      capturedAt,
      lastAccessedAt: capturedAt,
      memoryLayer: 'context',
      metadata: { sourceId: `tpc_${title}` },
      title,
      userId: owner,
    })
    .returning();
  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      capturedAt,
      description: `${title} details`,
      title,
      userId: owner,
      userMemoryIds: [memory.id],
    })
    .returning();
  return { context, memory };
};

let model: UserMemoryContextStoryModel;
let consolidation: UserMemoryConsolidationModel;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  model = new UserMemoryContextStoryModel(serverDB, userId);
  consolidation = new UserMemoryConsolidationModel(serverDB, userId);
});

describe('UserMemoryContextStoryModel', () => {
  it('lists only consolidated contexts, newest evidence first, with dossier and evidence counts', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const b = await createLegacy('scheduler panel', '2026-05-03');
    const c = await createLegacy('pricing page', '2026-06-10');
    await createLegacy('one-off question', '2026-06-11');
    await createLegacy('someone else', '2026-06-12', otherUserId);

    await consolidation.applyContextPlan('run_1', {
      dossiers: [
        { memberIds: [a.context.id], now: 'Backend shipped', title: 'Backend' },
        { memberIds: [b.context.id], now: 'Panel shipped', title: 'Panel' },
      ],
      nextSteps: ['Ship cron mode'],
      now: 'Scheduler is live',
      openQuestions: ['Who owns retries?'],
      title: 'Task system',
    });
    await consolidation.applyContextPlan('run_1', {
      dossiers: [{ memberIds: [c.context.id], now: 'Draft ready', title: 'Pricing page' }],
      nextSteps: [],
      now: 'Pricing in review',
      openQuestions: [],
      title: 'Pricing',
    });

    const { legacyCount, stories } = await model.listStories();

    expect(stories.map((s) => s.title)).toEqual(['Pricing', 'Task system']);
    expect(stories[1]).toMatchObject({
      dossierCount: 2,
      evidenceCount: 2,
      nextSteps: ['Ship cron mode'],
      now: 'Scheduler is live',
      openQuestions: ['Who owns retries?'],
    });
    expect(['active', 'dormant', 'closed']).toContain(stories[1].status);
    // The filed legacy rows are superseded; the leftover one still counts.
    expect(legacyCount).toBe(1);
  });

  it('reads one story with dossiers and their evidence, newest first', async () => {
    await serverDB.insert(agents).values({ id: 'agt_story', userId });
    // Only the panel's topic still exists; another user's topic with the same id never links.
    await serverDB
      .insert(topics)
      .values({ agentId: 'agt_story', id: 'tpc_scheduler panel', title: 'Panel chat', userId });
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const b = await createLegacy('scheduler panel', '2026-05-03');
    const { contextId } = await consolidation.applyContextPlan('run_1', {
      dossiers: [{ memberIds: [a.context.id, b.context.id], now: 'Shipped', title: 'Scheduler' }],
      nextSteps: [],
      now: 'Scheduler is live',
      openQuestions: [],
      title: 'Task system',
    });

    const story = await model.getStory(contextId!);

    expect(story).toMatchObject({ dossierCount: 1, evidenceCount: 2, title: 'Task system' });
    expect(story!.dossiers[0]).toMatchObject({
      activityCount: 2,
      now: 'Shipped',
      title: 'Scheduler',
    });
    expect(
      story!.dossiers[0].evidence.map((e) => [e.title, e.sourceTopicId, e.sourceAgentId]),
    ).toEqual([
      ['scheduler panel', 'tpc_scheduler panel', 'agt_story'],
      ['scheduler backend', null, null],
    ]);
    expect(story!.dossiers[0].evidence[0].sourceTopicTitle).toBe('Panel chat');
  });

  it('returns null for a legacy context, a trashed story and another user’s story', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const legacy = await createLegacy('one-off question', '2026-06-11');
    const { contextId } = await consolidation.applyContextPlan('run_1', {
      dossiers: [{ memberIds: [a.context.id], now: 'Shipped', title: 'Scheduler' }],
      nextSteps: [],
      now: 'Scheduler is live',
      openQuestions: [],
      title: 'Task system',
    });

    expect(await model.getStory(legacy.context.id)).toBeNull();
    expect(
      await new UserMemoryContextStoryModel(serverDB, otherUserId).getStory(contextId!),
    ).toBeNull();

    const [context] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, contextId!));
    await serverDB
      .update(userMemories)
      .set({ isDeleted: true })
      .where(eq(userMemories.id, context.userMemoryId!));

    expect(await model.getStory(contextId!)).toBeNull();
    expect((await model.listStories()).stories).toHaveLength(0);
  });

  it('returns no stories for a user who was never consolidated', async () => {
    await createLegacy('scheduler backend', '2026-05-01');
    await createLegacy('scheduler panel', '2026-05-03');

    expect(await model.listStories()).toMatchObject({ legacyCount: 2, stories: [] });
  });
});
