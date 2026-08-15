// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
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
});
