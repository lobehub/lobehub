// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { trashItems, users, widgetRuns, widgets, widgetVersions } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { CreateWidgetVersionInput } from '../widget';
import { WidgetModel } from '../widget';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'widget-guards-user';
const otherUserId = 'widget-guards-other';
const NOT_A_UUID = 'not-a-uuid';

const script = (n: number): CreateWidgetVersionInput => ({
  manifest: { title: `v${n}` },
  outputType: 'stat',
  runtime: 'node',
  script: `console.log(${n})`,
  sourceType: 'agent',
  view: { size: 'sm' },
});

beforeEach(async () => {
  await serverDB.delete(widgetRuns);
  await serverDB.delete(widgetVersions);
  await serverDB.delete(widgets);
  await serverDB.delete(trashItems);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(widgetRuns);
  await serverDB.delete(widgetVersions);
  await serverDB.delete(widgets);
  await serverDB.delete(trashItems);
  await serverDB.delete(users);
});

describe('WidgetModel guards and scheduling', () => {
  const model = new WidgetModel(serverDB, userId);
  const other = new WidgetModel(serverDB, otherUserId);

  it('short-circuits every id-scoped method on a malformed uuid', async () => {
    const widget = await model.create({ title: 'Guards' });
    const version = await model.createVersion(widget!.id, script(1));

    expect(await model.restore(NOT_A_UUID)).toBeUndefined();
    expect(await model.delete(NOT_A_UUID)).toBeUndefined();
    expect(await model.purge(NOT_A_UUID)).toBeUndefined();
    expect(
      await model.setSchedule(NOT_A_UUID, {
        nextRunAt: null,
        schedulePattern: null,
        scheduleTimezone: null,
      }),
    ).toBeUndefined();
    expect(await model.createVersion(NOT_A_UUID, script(2))).toBeUndefined();
    expect(await model.findVersion(widget!.id, NOT_A_UUID)).toBeUndefined();
    expect(await model.publishVersion(NOT_A_UUID, version!.id)).toBeUndefined();
    expect(await model.publishVersion(widget!.id, NOT_A_UUID)).toBeUndefined();
    expect(await model.finishRun(NOT_A_UUID, { status: 'succeeded' })).toBeUndefined();
    expect(await model.findRun(widget!.id, NOT_A_UUID)).toBeUndefined();
    expect(await model.findPreviewRun(widget!.id, NOT_A_UUID)).toBeUndefined();
    expect(await WidgetModel.findLiveWithPublishedVersion(serverDB, NOT_A_UUID)).toBeUndefined();
    expect(
      await WidgetModel.renewRunLease(serverDB, {
        expectedStartedAt: new Date(),
        runId: NOT_A_UUID,
      }),
    ).toBeUndefined();
    await expect(
      WidgetModel.startRun(serverDB, widget!, { trigger: 'preview', versionId: NOT_A_UUID }),
    ).rejects.toThrow('Version does not belong to this widget');
  });

  it('filters malformed scheduler ids instead of querying', async () => {
    const options = {
      createdAfter: new Date(0),
      limit: 10,
      startedBefore: new Date(),
    };

    expect(
      await WidgetModel.findStaleScheduledRuns(serverDB, { ...options, runId: NOT_A_UUID }),
    ).toEqual([]);
    expect(
      await WidgetModel.findStaleScheduledRuns(serverDB, { ...options, widgetId: NOT_A_UUID }),
    ).toEqual([]);
  });

  it('replaces a schedule and fails the runs reserved by the old one', async () => {
    const widget = await model.create({
      schedulePattern: '0 * * * *',
      scheduleTimezone: 'UTC',
      title: 'Scheduled',
    });
    const version = await model.createVersion(widget!.id, script(1));
    await model.publishVersion(widget!.id, version!.id);

    const [run] = await serverDB
      .insert(widgetRuns)
      .values({
        status: 'running',
        trigger: 'schedule',
        userId,
        versionId: version!.id,
        widgetId: widget!.id,
      })
      .returning();

    const nextRunAt = new Date('2026-10-19T00:00:00.000Z');
    const updated = await model.setSchedule(widget!.id, {
      nextRunAt,
      schedulePattern: '*/5 * * * *',
      scheduleTimezone: 'Asia/Shanghai',
    });

    expect(updated).toMatchObject({
      nextRunAt,
      schedulePattern: '*/5 * * * *',
      scheduleTimezone: 'Asia/Shanghai',
    });

    const [failedRun] = await serverDB.select().from(widgetRuns).where(eq(widgetRuns.id, run.id));
    expect(failedRun).toMatchObject({
      error: {
        code: 'SCHEDULE_CHANGED',
        message: 'The schedule changed before this run finished',
      },
      status: 'failed',
    });
    expect(failedRun.finishedAt).not.toBeNull();
  });

  it('does not let another user reschedule a widget', async () => {
    const widget = await model.create({ title: 'Owner only' });

    expect(
      await other.setSchedule(widget!.id, {
        nextRunAt: null,
        schedulePattern: null,
        scheduleTimezone: null,
      }),
    ).toBeUndefined();
  });

  it('defaults the due query window when options are omitted', async () => {
    const schedule = async (title: string, nextRunAt: Date) => {
      const widget = await model.create({
        schedulePattern: '0 * * * *',
        scheduleTimezone: 'UTC',
        title,
      });
      const version = await model.createVersion(widget!.id, script(1));
      await model.publishVersion(widget!.id, version!.id);
      await model.setSchedule(widget!.id, {
        nextRunAt,
        schedulePattern: '0 * * * *',
        scheduleTimezone: 'UTC',
      });
      return widget!;
    };

    // A populated table is what makes the defaults observable: an empty read
    // stays green for any cutoff or limit.
    await schedule('Due earlier', new Date('2026-10-01T00:00:00.000Z'));
    await schedule('Due later', new Date('2026-10-02T00:00:00.000Z'));
    await schedule('Not due yet', new Date('2030-01-01T00:00:00.000Z'));

    const due = await WidgetModel.findDue(serverDB);

    // Both due rows and no future one: the omitted window is "now", and the
    // omitted limit cannot be 0.
    expect(due.map((row) => row.widget.title)).toEqual(['Due earlier', 'Due later']);
  });
});
