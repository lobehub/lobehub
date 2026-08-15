// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  topics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'expertise-model-test-user';
const runId = '6432288d-281b-4ffa-839f-8e8f45502f57';
const lessonId = '7e21f858-688d-4a20-9866-51a256f2154a';
const hitId = 'f72c127c-9fc5-4122-8824-8955c6520c03';

describe('ExpertiseModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('returns the source topic title for a lesson hit', async () => {
    await serverDB.insert(topics).values({
      id: 'expertise-source-topic',
      title: '排查生产环境连接池超时',
      userId,
    });
    await serverDB.insert(expertiseDomains).values({
      domainFilter: '生产故障排查',
      id: 'expertise-test-domain',
      slug: 'expertise-test-domain',
      title: '生产故障排查',
      userId,
    });
    await serverDB.insert(expertiseRuns).values({
      actorId: 'agent-1',
      actorType: 'agent',
      domainId: 'expertise-test-domain',
      id: runId,
      runIndex: 1,
      subjectId: 'expertise-source-topic',
      subjectType: 'topic',
      userId,
    });
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      domainId: 'expertise-test-domain',
      id: lessonId,
      polarity: 'rule',
      sections: [{ body: '先看连接池指标', key: 'rule' }],
      title: '先看连接池指标',
    });
    await serverDB.insert(expertiseHits).values({
      domainId: 'expertise-test-domain',
      id: hitId,
      lessonId,
      outcome: 'pass',
      runId,
    });

    const [hit] = await new ExpertiseModel(serverDB, userId).listLessonHits(lessonId);

    expect(hit.runTitle).toBe('排查生产环境连接池超时');
    expect(hit.subjectId).toBe('expertise-source-topic');
  });

  it('does not resolve domains through an agent owned by another user', async () => {
    const foreignUserId = 'expertise-foreign-user';
    await serverDB.insert(users).values({ id: foreignUserId });
    await serverDB.insert(agents).values({ id: 'foreign-agent', userId: foreignUserId });
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: 'Foreign domain',
      id: 'foreign-domain',
      slug: 'foreign-domain',
      title: 'Foreign domain',
      userId: foreignUserId,
    });
    await serverDB.insert(expertiseBindings).values({
      agentId: 'foreign-agent',
      domainId: 'foreign-domain',
    });

    await expect(
      new ExpertiseModel(serverDB, userId).listDomainsForAgent('foreign-agent'),
    ).resolves.toEqual([]);
  });

  it('does not expose lesson detail or evidence from another user domain', async () => {
    const foreignUserId = 'expertise-foreign-lesson-user';
    const foreignLessonId = '5c661584-9ee7-49d4-8623-573243f3c51a';
    await serverDB.insert(users).values({ id: foreignUserId });
    await serverDB.insert(expertiseDomains).values({
      anchorChosenAt: new Date(),
      domainFilter: 'Foreign domain',
      id: 'foreign-lesson-domain',
      slug: 'foreign-lesson-domain',
      title: 'Foreign domain',
      userId: foreignUserId,
    });
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      domainId: 'foreign-lesson-domain',
      id: foreignLessonId,
      polarity: 'rule',
      sections: [],
      title: 'Foreign lesson',
    });

    const model = new ExpertiseModel(serverDB, userId);
    await expect(model.findLesson(foreignLessonId)).resolves.toBeUndefined();
    await expect(model.listLessons('foreign-lesson-domain')).resolves.toEqual([]);
    await expect(model.listLessonHits(foreignLessonId)).resolves.toEqual([]);
  });
});
