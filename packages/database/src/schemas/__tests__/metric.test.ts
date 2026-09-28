// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { metricPoints, metrics, users } from '..';

const serverDB = await getTestDB();
const userId = 'metric-schema-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('metrics schema', () => {
  it('generates prefixed series ids and keeps one series per (subject, key)', async () => {
    const [series] = await serverDB
      .insert(metrics)
      .values({
        key: 'twitter.followers',
        subjectId: 'goal_schema_test',
        subjectType: 'goal',
        userId,
      })
      .returning();

    expect(series.id).toMatch(/^mtr_/);
    expect(series.kind).toBe('gauge');

    await expect(
      serverDB.insert(metrics).values({
        key: 'twitter.followers',
        subjectId: 'goal_schema_test',
        subjectType: 'goal',
        userId,
      }),
    ).rejects.toThrow();

    // Same key on another subject is a different series.
    await expect(
      serverDB.insert(metrics).values({
        key: 'twitter.followers',
        subjectId: 'goal_schema_test_other',
        subjectType: 'goal',
        userId,
      }),
    ).resolves.not.toThrow();
  });

  it('stores numeric points that cascade with their series', async () => {
    const [series] = await serverDB
      .insert(metrics)
      .values({
        key: 'spend.usd',
        metadata: { probeTaskId: 'task_probe_x' },
        subjectId: 'agt_x',
        subjectType: 'agent',
        userId,
      })
      .returning();
    expect(series.metadata).toEqual({ probeTaskId: 'task_probe_x' });

    await serverDB.insert(metricPoints).values([
      {
        actorType: 'system',
        metricId: series.id,
        observedAt: new Date('2026-09-01T00:00:00Z'),
        sourceType: 'probe',
        userId,
        value: 12.5,
      },
      {
        actorType: 'user',
        metricId: series.id,
        observedAt: new Date('2026-09-02T00:00:00Z'),
        sourceType: 'manual',
        userId,
        value: 13.25,
      },
    ]);

    const points = await serverDB
      .select()
      .from(metricPoints)
      .where(eq(metricPoints.metricId, series.id))
      .orderBy(metricPoints.observedAt);
    // amountNumeric is mode 'number' — charts consume numbers, not strings.
    expect(points.map((p) => p.value)).toEqual([12.5, 13.25]);

    await serverDB.delete(metrics).where(eq(metrics.id, series.id));
    expect(
      await serverDB.select().from(metricPoints).where(eq(metricPoints.metricId, series.id)),
    ).toHaveLength(0);
  });
});
