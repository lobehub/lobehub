// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { userMemories, userMemoriesContexts, userMemoriesDossiers, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryContextStoryModel } from '../contextStory';

const userId = 'context-story-edges-user';
const otherUserId = 'context-story-edges-other';
const serverDB: LobeChatDatabase = await getTestDB();

let model: UserMemoryContextStoryModel;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  model = new UserMemoryContextStoryModel(serverDB, userId);
});

/** A context consolidation already synthesized, written directly so the test controls its gaps. */
const seedStoryContext = async ({
  day = '2026-05-01',
  title,
  withDossier = false,
}: {
  day?: string;
  title: string;
  withDossier?: boolean;
}) => {
  const capturedAt = new Date(`${day}T08:00:00.000Z`);
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      capturedAt,
      lastAccessedAt: capturedAt,
      memoryLayer: 'context',
      state: 'active',
      title,
      userId,
    })
    .returning();
  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      capturedAt,
      // A regroup can leave these unset: the story must not invent a status or a plan.
      currentStatus: null,
      description: title,
      lastEvidenceAt: capturedAt,
      nextSteps: null,
      now: title,
      openQuestions: null,
      synthesizedAt: capturedAt,
      title,
      userId,
      userMemoryId: memory.id,
      userMemoryIds: [memory.id],
    })
    .returning();

  const dossier = withDossier
    ? (
        await serverDB
          .insert(userMemoriesDossiers)
          .values({
            activityCount: 0,
            contextId: context.id,
            firstSeenAt: capturedAt,
            lastEvidenceAt: null,
            status: 'active',
            title: `${title} dossier`,
            userId,
          })
          .returning()
      )[0]
    : undefined;

  return { context, memory, dossier };
};

describe('UserMemoryContextStoryModel on sparse stories', () => {
  it('reads a consolidated context with no dossiers as an empty, closed story', async () => {
    const { context } = await seedStoryContext({ title: 'Nobody filed evidence' });

    const { stories } = await model.listStories();

    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({
      dossierCount: 0,
      evidenceCount: 0,
      nextSteps: [],
      openQuestions: [],
      status: 'closed',
      title: 'Nobody filed evidence',
    });

    expect(await model.getStory(context.id)).toMatchObject({
      dossiers: [],
      dossierCount: 0,
      evidenceCount: 0,
    });
  });

  it('reads a dossier that has no evidence yet with an empty evidence list', async () => {
    const { context } = await seedStoryContext({ title: 'Evidence pending', withDossier: true });

    const story = await model.getStory(context.id);

    expect(story).toMatchObject({ dossierCount: 1, evidenceCount: 0 });
    expect(story!.dossiers).toHaveLength(1);
    expect(story!.dossiers[0]).toMatchObject({ activityCount: 0, evidence: [], status: 'active' });
  });

  it('skips an evidence row the query could not tie to a dossier', async () => {
    // The evidence read filters on `dossier_id IN (...)`, so a row without one is a
    // defensive case the query itself cannot return; the story must not crash on it.
    const context = {
      firstSeenAt: null,
      id: 'ctx_stubbed',
      lastEvidenceAt: null,
      nextSteps: [],
      now: 'v1',
      openQuestions: [],
      status: 'active',
      title: 'Stubbed',
    };
    const dossier = {
      activityCount: 1,
      firstSeenAt: null,
      id: 'dossier_stubbed',
      lastEvidenceAt: null,
      now: 'v1',
      status: 'active',
      title: 'Stubbed dossier',
    };
    const select = vi.spyOn(serverDB, 'select');
    select.mockReturnValueOnce({
      from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [context] }) }) }),
    } as unknown as ReturnType<LobeChatDatabase['select']>);
    select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: async () => [dossier] }) }),
    } as unknown as ReturnType<LobeChatDatabase['select']>);
    select.mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: () => ({ limit: async () => [{ dossierId: null, id: 'x' }] }),
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<LobeChatDatabase['select']>);

    const story = await model.getStory('ctx_stubbed');

    expect(story!.dossiers[0].evidence).toEqual([]);
    select.mockRestore();
  });

  it('counts no legacy rows when the aggregate comes back without a row', async () => {
    // `count(*)` always yields a row in Postgres, so an empty result set is a defensive
    // case; the page must read 0 rather than undefined.
    const select = vi.spyOn(serverDB, 'select');
    select.mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: () => ({ as: () => 'capped' }) }) }),
      }),
    } as unknown as ReturnType<LobeChatDatabase['select']>);
    select.mockReturnValueOnce({
      from: async () => [],
    } as unknown as ReturnType<LobeChatDatabase['select']>);

    expect(await model.countLegacy()).toBe(0);
    select.mockRestore();
  });
});
