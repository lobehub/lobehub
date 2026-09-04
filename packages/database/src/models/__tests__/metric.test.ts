// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MetricModel } from '../metric';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'metric-model-test-user';
const otherUserId = 'metric-model-other-user';
const model = new MetricModel(serverDB, userId);
const otherModel = new MetricModel(serverDB, otherUserId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const seed = (key = 'twitter.followers') =>
  model.ensure({ key, subjectId: 'goal_metric_test', subjectType: 'goal' });

describe('MetricModel', () => {
  describe('ensure', () => {
    it('creates the series once and returns the existing row on repeat', async () => {
      const first = await seed();
      const again = await model.ensure({
        key: 'twitter.followers',
        subjectId: 'goal_metric_test',
        subjectType: 'goal',
        // Racing probe passes a different title — ensure must not overwrite.
        title: 'Should not stick',
      });

      expect(first?.id).toMatch(/^mtr_/);
      expect(again?.id).toBe(first?.id);
      expect(again?.title).toBeNull();
    });

    it('does not surface a slot owned by another user', async () => {
      await seed();
      const stolen = await otherModel.ensure({
        key: 'twitter.followers',
        subjectId: 'goal_metric_test',
        subjectType: 'goal',
      });
      expect(stolen).toBeUndefined();
    });
  });

  describe('series reads and writes', () => {
    it('lists a subject ordered by key and scopes reads to the owner', async () => {
      await seed('b.metric');
      await seed('a.metric');

      const listed = await model.findBySubject('goal', 'goal_metric_test');
      expect(listed.map((s) => s.key)).toEqual(['a.metric', 'b.metric']);
      expect(await otherModel.findBySubject('goal', 'goal_metric_test')).toEqual([]);
    });

    it('updates definition fields under ownership only', async () => {
      const series = (await seed())!;

      const patched = await model.update(series.id, { title: 'Followers', unit: 'count' });
      expect(patched).toMatchObject({ title: 'Followers', unit: 'count' });

      expect(await otherModel.update(series.id, { title: 'hijack' })).toBeUndefined();
      expect((await model.findById(series.id))?.title).toBe('Followers');
    });
  });

  describe('points', () => {
    it('appends through the owned series and refuses foreign or missing series', async () => {
      const series = (await seed())!;

      const point = await model.addPoint(series.id, {
        actorType: 'system',
        observedAt: new Date('2026-09-01T00:00:00Z'),
        sourceType: 'probe',
        value: 42,
      });
      expect(point).toMatchObject({ metricId: series.id, userId, value: 42 });

      expect(
        await otherModel.addPoint(series.id, {
          actorType: 'user',
          observedAt: new Date(),
          sourceType: 'manual',
          value: 1,
        }),
      ).toBeUndefined();
      expect(
        await model.addPoint('mtr_missing', {
          actorType: 'user',
          observedAt: new Date(),
          sourceType: 'manual',
          value: 1,
        }),
      ).toBeUndefined();
    });

    it('reads the latest observation by observed time, not insert order', async () => {
      const series = (await seed())!;
      // Backfill arrives after the fresher sample — observedAt must win.
      await model.addPoint(series.id, {
        actorType: 'system',
        observedAt: new Date('2026-09-02T00:00:00Z'),
        sourceType: 'probe',
        value: 200,
      });
      await model.addPoint(series.id, {
        actorType: 'user',
        observedAt: new Date('2026-09-01T00:00:00Z'),
        sourceType: 'manual',
        value: 100,
      });

      expect((await model.latestPoint(series.id))?.value).toBe(200);
    });
  });

  describe('listPoints', () => {
    const day = (d: number, h = 0) => new Date(Date.UTC(2026, 8, d, h));

    const seedWeek = async (kind: 'gauge' | 'counter') => {
      const series = (await model.ensure({
        key: `series.${kind}`,
        kind,
        subjectId: 'goal_metric_test',
        subjectType: 'goal',
      }))!;
      // Two samples on Sep 1, one on Sep 2.
      for (const [at, value] of [
        [day(1, 0), 10],
        [day(1, 12), 30],
        [day(2, 0), 20],
      ] as const) {
        await model.addPoint(series.id, {
          actorType: 'system',
          observedAt: at,
          sourceType: 'probe',
          value,
        });
      }
      return series;
    };

    it('returns raw points ascending within the requested range', async () => {
      const series = await seedWeek('gauge');

      const result = await model.listPoints(series.id, { from: day(1, 6), to: day(2, 6) });
      expect(result?.points.map((p) => p.value)).toEqual([30, 20]);
      expect(result?.series.kind).toBe('gauge');
    });

    it('aggregates buckets by the series kind: gauge averages, counter takes max', async () => {
      const gauge = await seedWeek('gauge');
      const counter = await seedWeek('counter');

      const gaugeDays = await model.listPoints(gauge.id, { bucket: 'day' });
      expect(gaugeDays?.points.map((p) => p.value)).toEqual([20, 20]); // avg(10,30), avg(20)

      const counterDays = await model.listPoints(counter.id, { bucket: 'day' });
      expect(counterDays?.points.map((p) => p.value)).toEqual([30, 20]); // max(10,30), max(20)
      expect(counterDays?.points[0]?.observedAt).toEqual(day(1));
    });

    it('returns undefined for a series outside the owner scope', async () => {
      const series = await seedWeek('gauge');
      expect(await otherModel.listPoints(series.id)).toBeUndefined();
    });

    it('keeps the newest window when the limit truncates, still ascending', async () => {
      const series = await seedWeek('gauge');

      const raw = await model.listPoints(series.id, { limit: 2 });
      expect(raw?.points.map((p) => p.value)).toEqual([30, 20]);

      const bucketed = await model.listPoints(series.id, { bucket: 'day', limit: 1 });
      expect(bucketed?.points.map((p) => p.observedAt)).toEqual([day(2)]);
    });
  });

  describe('delete', () => {
    it('cascades points with the series', async () => {
      const series = (await seed())!;
      await model.addPoint(series.id, {
        actorType: 'user',
        observedAt: new Date(),
        sourceType: 'manual',
        value: 1,
      });

      const deleted = await model.delete(series.id);

      expect(deleted?.id).toBe(series.id);
      expect(await model.findById(series.id)).toBeUndefined();
      expect(await model.latestPoint(series.id)).toBeUndefined();
    });

    it('reports nothing deleted for a foreign or missing series', async () => {
      const series = (await seed())!;
      expect(await otherModel.delete(series.id)).toBeUndefined();
      expect(await model.findById(series.id)).toBeDefined();
      expect(await model.delete('mtr_missing')).toBeUndefined();
    });
  });
});
