// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, widgetRuns, widgets } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { CreateWidgetVersionInput } from '../widget';
import { WidgetModel } from '../widget';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'widget-coverage-user';

const script: CreateWidgetVersionInput = {
  manifest: { title: 'v1' },
  outputType: 'stat',
  runtime: 'node',
  script: 'console.log(1)',
  sourceType: 'agent',
  view: { size: 'sm' },
};

const createPublishedWidget = async () => {
  const model = new WidgetModel(serverDB, userId);
  const widget = await model.create({ title: 'Coverage' });
  const version = await model.createVersion(widget!.id, script);
  await model.publishVersion(widget!.id, version!.id);
  return (await model.findById(widget!.id))!;
};

beforeEach(async () => {
  // Widgets, their versions and runs cascade from the owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('WidgetModel coverage', () => {
  it('update with a malformed id changes no widget and yields none', async () => {
    const widget = await createPublishedWidget();

    // The private-parent probe reads a malformed id as "no parent"; whether the
    // update then resolves to nothing or is rejected by the uuid column, no
    // widget comes back and none is touched.
    const result = await new WidgetModel(serverDB, userId)
      .update('not-a-uuid', { visibility: 'public' })
      .catch(() => undefined);

    expect(result).toBeUndefined();
    const [row] = await serverDB.select().from(widgets).where(eq(widgets.id, widget.id));
    expect(row.updatedAt).toEqual(widget.updatedAt);
  });

  it('findPreviewRun returns undefined for an unreadable widget or a foreign version', async () => {
    const model = new WidgetModel(serverDB, userId);
    const widget = await createPublishedWidget();

    expect(await model.findPreviewRun(randomUUID(), widget.publishedVersionId!)).toBeUndefined();
    expect(await model.findPreviewRun(widget.id, randomUUID())).toBeUndefined();
  });

  it('startRun refuses a widget that was deleted after the caller read it', async () => {
    const widget = await createPublishedWidget();
    await serverDB.update(widgets).set({ isDeleted: true }).where(eq(widgets.id, widget.id));

    await expect(WidgetModel.startRun(serverDB, widget, { trigger: 'schedule' })).rejects.toThrow(
      'Widget unavailable',
    );
    expect(
      await serverDB.select().from(widgetRuns).where(eq(widgetRuns.widgetId, widget.id)),
    ).toEqual([]);
  });

  it('startRun refuses a widget row that no longer exists', async () => {
    const widget = await createPublishedWidget();

    await expect(
      WidgetModel.startRun(serverDB, { ...widget, id: randomUUID() }, { trigger: 'schedule' }),
    ).rejects.toThrow('Widget unavailable');
  });

  it('static finishRun returns undefined for an unknown run', async () => {
    expect(
      await WidgetModel.finishRun(serverDB, randomUUID(), { status: 'succeeded' }),
    ).toBeUndefined();
  });

  it('static finishRun fences on expectedStartedAt', async () => {
    const widget = await createPublishedWidget();
    const run = await WidgetModel.startRun(serverDB, widget, { trigger: 'schedule' });

    // A worker holding a stale lease start cannot finish the run.
    const stale = await WidgetModel.finishRun(serverDB, run.id, {
      expectedStartedAt: new Date(run.startedAt.getTime() - 60_000),
      status: 'succeeded',
    });
    expect(stale).toBeUndefined();
    const [stillRunning] = await serverDB
      .select()
      .from(widgetRuns)
      .where(eq(widgetRuns.id, run.id));
    expect(stillRunning.status).toBe('running');

    // The worker that owns the current lease finishes and folds into the widget.
    const current = await WidgetModel.finishRun(serverDB, run.id, {
      expectedStartedAt: run.startedAt,
      status: 'succeeded',
    });
    expect(current).toMatchObject({ folded: true, run: { id: run.id, status: 'succeeded' } });
    const [snapshot] = await serverDB.select().from(widgets).where(eq(widgets.id, widget.id));
    expect(snapshot.lastRunId).toBe(run.id);
  });
});
