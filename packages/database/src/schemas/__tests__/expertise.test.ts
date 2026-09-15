// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  users,
} from '..';

const serverDB = await getTestDB();
const userId = 'expertise-schema-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

const createFixture = async () => {
  const [domainA, domainB] = await serverDB
    .insert(expertiseDomains)
    .values([
      {
        domainFilter: 'Domain A work only',
        id: 'epd_schema_test_a',
        slug: 'schema-test-a',
        title: 'Schema test A',
        userId,
      },
      {
        domainFilter: 'Domain B work only',
        id: 'epd_schema_test_b',
        slug: 'schema-test-b',
        title: 'Schema test B',
        userId,
      },
    ])
    .returning();

  const [runA, runB] = await serverDB
    .insert(expertiseRuns)
    .values([
      {
        actorId: 'agent-a',
        actorType: 'agent',
        domainId: domainA.id,
        runIndex: 1,
        subjectId: 'topic-a',
        subjectType: 'topic',
      },
      {
        actorId: 'agent-b',
        actorType: 'agent',
        domainId: domainB.id,
        runIndex: 1,
        subjectId: 'topic-b',
        subjectType: 'topic',
      },
    ])
    .returning();

  const [lessonA, lessonB] = await serverDB
    .insert(expertiseLessons)
    .values([
      {
        code: 'P-01',
        domainId: domainA.id,
        polarity: 'rule',
        sections: [{ body: 'Rule A', key: 'rule' }],
        title: 'Rule A',
      },
      {
        code: 'P-01',
        domainId: domainB.id,
        polarity: 'rule',
        sections: [{ body: 'Rule B', key: 'rule' }],
        title: 'Rule B',
      },
    ])
    .returning();

  return { domainA, domainB, lessonA, lessonB, runA, runB };
};

describe('expertise domain constraints', () => {
  it('rejects hits whose run or lesson belongs to another domain', async () => {
    const { domainB, lessonA, lessonB, runA, runB } = await createFixture();

    await expect(
      serverDB.insert(expertiseHits).values({
        domainId: domainB.id,
        lessonId: lessonB.id,
        outcome: 'pass',
        runId: runB.id,
      }),
    ).resolves.toBeDefined();

    await expect(
      serverDB.insert(expertiseHits).values({
        domainId: domainB.id,
        lessonId: lessonB.id,
        outcome: 'pass',
        runId: runA.id,
      }),
    ).rejects.toThrow();

    await expect(
      serverDB.insert(expertiseHits).values({
        domainId: domainB.id,
        lessonId: lessonA.id,
        outcome: 'pass',
        runId: runB.id,
      }),
    ).rejects.toThrow();
  });

  it('rejects snapshots whose run belongs to another domain', async () => {
    const { domainB, runA, runB } = await createFixture();

    await expect(
      serverDB.insert(expertiseDomainSnapshots).values({
        activeCount: 1,
        domainId: domainB.id,
        learnedTotal: 1,
        runId: runB.id,
        runIndex: 1,
      }),
    ).resolves.toBeDefined();

    await expect(
      serverDB.insert(expertiseDomainSnapshots).values({
        activeCount: 1,
        domainId: domainB.id,
        learnedTotal: 1,
        runId: runA.id,
        runIndex: 2,
      }),
    ).rejects.toThrow();
  });
});
