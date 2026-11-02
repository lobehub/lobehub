import type { LobeChatDatabase } from '@lobechat/database';
import { metricPoints, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WidgetModel } from '@/database/models/widget';

import { recordWidgetMetrics } from '../metrics';

const userId = 'widget-metrics-user';
let db: LobeChatDatabase;

beforeEach(async () => {
  db = await getTestDB();
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('recordWidgetMetrics', () => {
  it('trends a data output only through manifest.metric.valuePath', async () => {
    const model = new WidgetModel(db, userId);
    const widget = await model.create({ title: 'Weather' });
    const version = await model.createVersion(widget.id, {
      outputType: 'data',
      runtime: 'node',
      script: 'console.log("{}")',
      sourceType: 'agent',
    });
    await model.publishVersion(widget.id, version!.id);
    const run = await model.startRun(widget.id, { trigger: 'manual' });
    const output = { data: { current: { temp: 18.4 } }, type: 'data' as const };
    const record = (manifest?: { metric: { key: string; valuePath: string } }) =>
      recordWidgetMetrics(db, widget, { manifest, observedAt: new Date(), output, runId: run!.id });

    expect(await record()).toEqual({ pointsWritten: 0 });

    const result = await record({ metric: { key: 'temp', valuePath: 'data.current.temp' } });
    expect(result.pointsWritten).toBe(1);
    const points = await db
      .select()
      .from(metricPoints)
      .where(eq(metricPoints.metricId, result.primaryMetricId!));
    expect(points.map((p) => p.value)).toEqual([18.4]);
  });
});
