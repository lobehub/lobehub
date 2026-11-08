// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseLessonRevisions,
  expertiseLessons,
  expertiseRuns,
  users,
  verifyCheckResults,
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

  it('keeps a hit after the rejection it was learned from is deleted', async () => {
    const { domainB, lessonB, runB } = await createFixture();

    const [checkResult] = await serverDB
      .insert(verifyCheckResults)
      .values({ checkItemId: 'check-item-1', userId, verifierType: 'agent' })
      .returning();

    const [hit] = await serverDB
      .insert(expertiseHits)
      .values({
        domainId: domainB.id,
        lessonId: lessonB.id,
        outcome: 'violation',
        runId: runB.id,
        sourceCheckResultId: checkResult.id,
      })
      .returning();

    await serverDB.delete(verifyCheckResults).where(eq(verifyCheckResults.id, checkResult.id));

    // Provenance, not ownership: deleting an acceptance must not delete what it taught.
    const [survivor] = await serverDB
      .select()
      .from(expertiseHits)
      .where(eq(expertiseHits.id, hit.id));

    expect(survivor).toBeDefined();
    expect(survivor.sourceCheckResultId).toBeNull();
  });

  it('keeps which accepted delivery a generalized boundary was read from', async () => {
    const { lessonB } = await createFixture();
    const evidence = {
      boundaries: [
        {
          checkResultIds: ['ok-menu'],
          limit: 'Separators that isolate a destructive menu action are allowed',
        },
      ],
      instances: ['rejected-1', 'rejected-2', 'rejected-3'],
      shipped: ['ok-menu', 'ok-table'],
    };

    await serverDB.insert(expertiseLessonRevisions).values([
      {
        changedBy: 'system',
        evidence,
        kind: 'generalize',
        lessonId: lessonB.id,
        revision: 1,
        sections: [],
      },
      // A person's rewrite carries its authority in `feedback`, so it has no evidence.
      {
        changedBy: 'user',
        feedback: 'tables are fine',
        lessonId: lessonB.id,
        revision: 2,
        sections: [],
      },
    ]);

    const rows = await serverDB
      .select({
        evidence: expertiseLessonRevisions.evidence,
        revision: expertiseLessonRevisions.revision,
      })
      .from(expertiseLessonRevisions)
      .where(eq(expertiseLessonRevisions.lessonId, lessonB.id))
      .orderBy(expertiseLessonRevisions.revision);

    expect(rows).toEqual([
      { evidence, revision: 1 },
      { evidence: null, revision: 2 },
    ]);
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
