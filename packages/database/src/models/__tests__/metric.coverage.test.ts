// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { metrics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MetricModel } from '../metric';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 't863-metric-cov-user';
const model = new MetricModel(serverDB, userId);

const widgetSeries = (overrides: { kind?: 'counter' | 'gauge'; unit?: string } = {}) =>
  model.ensure({
    key: 'cpu.load',
    subjectId: 't863-widget',
    subjectType: 'widget',
    ...overrides,
  });

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // Series and points cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('MetricModel coverage', () => {
  describe('ensure on a widget series', () => {
    it('returns the existing row when the defaulted kind and unit still match', async () => {
      const first = await widgetSeries();
      const again = await widgetSeries();

      expect(first).toMatchObject({ kind: 'gauge', unit: null });
      expect(again?.id).toBe(first?.id);
    });

    it('returns the existing row when explicit kind and unit match', async () => {
      const first = await widgetSeries({ kind: 'counter', unit: 'ms' });
      const again = await widgetSeries({ kind: 'counter', unit: 'ms' });

      expect(again?.id).toBe(first?.id);
    });

    it('rejects a changed kind', async () => {
      await widgetSeries();

      await expect(widgetSeries({ kind: 'counter' })).rejects.toThrow(
        'Metric semantics changed: publish a new metric key',
      );
    });

    it('rejects a changed unit under the same kind', async () => {
      await widgetSeries({ kind: 'gauge' });

      await expect(widgetSeries({ kind: 'gauge', unit: 'ms' })).rejects.toThrow(
        'Metric semantics changed: publish a new metric key',
      );
    });
  });

  describe('update on a widget series', () => {
    it.each([
      ['kind', { kind: 'counter' as const }],
      ['unit', { unit: 'ms' }],
      ['metadata', { metadata: { note: 'x' } }],
    ])('rejects a changed %s and leaves the row untouched', async (_label, patch) => {
      const series = (await widgetSeries())!;

      await expect(model.update(series.id, patch)).rejects.toThrow(
        'Widget metric semantics are immutable: publish a new metric key',
      );
      expect(await model.findById(series.id)).toMatchObject({
        kind: 'gauge',
        metadata: null,
        unit: null,
      });
    });

    it('accepts a patch that restates the current kind and unit', async () => {
      const series = (await widgetSeries({ kind: 'counter', unit: 'ms' }))!;

      const updated = await model.update(series.id, {
        kind: 'counter',
        title: 'CPU load',
        unit: 'ms',
      });

      expect(updated).toMatchObject({ id: series.id, kind: 'counter', title: 'CPU load' });
    });
  });

  it('updates a non-widget series without the immutability check', async () => {
    const series = (await model.ensure({ key: 'k', subjectId: 'g', subjectType: 'goal' }))!;

    const updated = await model.update(series.id, { kind: 'counter', unit: 'pts' });

    expect(updated).toMatchObject({ kind: 'counter', unit: 'pts' });
    expect(
      await serverDB
        .select()
        .from(metrics)
        .where(inArray(metrics.id, [series.id])),
    ).toHaveLength(1);
  });
});
