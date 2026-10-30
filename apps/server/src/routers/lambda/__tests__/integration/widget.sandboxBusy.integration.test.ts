// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { widgetRuns, widgets } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { qstashClient } from '@/libs/qstash';
import widgetWorkflowApp from '@/server/router-hono/workflows/widget';
import { WidgetSandboxError } from '@/server/services/widget/sandbox/types';
import { WIDGET_BUSY_DEFER_DEADLINE_MS } from '@/server/services/widget/sandboxBusy';

import { widgetRouter } from '../../widget';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/featureFlags', async () => {
  const { mapFeatureFlagsEnvToState } = await import('@/config/featureFlags');
  return {
    getServerFeatureFlagsStateFromRuntimeConfig: async (userId?: string) =>
      mapFeatureFlagsEnvToState({ dashboard: true }, userId),
  };
});

const queueMode = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/envs/app', async (importOriginal) => {
  const mod = await importOriginal<{ appEnv: object }>();
  return {
    ...mod,
    appEnv: new Proxy(mod.appEnv, {
      get: (target, key) =>
        key === 'enableQueueAgentRuntime' ? queueMode.enabled : Reflect.get(target, key),
    }),
  };
});

const runSandbox = vi.fn();
vi.mock('@/server/services/widget/sandbox', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createWidgetSandboxRunner: () => ({ run: runSandbox }),
}));

const ok = (value: number) => ({
  durationMs: 12,
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify({ type: 'stat', value }),
  timedOut: false,
});

const busy = () =>
  new WidgetSandboxError(
    'SANDBOX_BUSY',
    'Sandbox is busy for this account: concurrency_limited: Too many concurrent sandbox runs',
    { retryAfterMs: 5000 },
  );

const statScript = {
  outputType: 'stat' as const,
  runtime: 'node' as const,
  script: `console.log(JSON.stringify({ type: 'stat', value: 7 }))`,
};

/**
 * Market caps one account's concurrent one-shot runs. A scheduled run it turns
 * away (`SANDBOX_BUSY`) waits in its reservation and is resumed through the
 * stale-lease recovery, instead of closing as failed until its next slot.
 */
describe('widget scheduled runs when the sandbox is busy', { timeout: 60_000 }, () => {
  let db: LobeChatDatabase;
  let ownerId: string;

  // The first call migrates the in-memory database; keep it out of the per-test hook budget.
  beforeAll(async () => {
    await getTestDB();
  }, 300_000);

  beforeEach(async () => {
    runSandbox.mockReset();
    db = await getTestDB();
    testDB = db;
    ownerId = await createTestUser(db);
  });

  afterEach(async () => {
    queueMode.enabled = false;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await cleanupTestUser(db, ownerId);
  });

  const post = async (path: string, body: unknown) =>
    (
      await widgetWorkflowApp.request(path, {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    ).json();

  /** A published, hourly widget whose slot is due. */
  const dueWidget = async () => {
    const owner = widgetRouter.createCaller({
      jwtPayload: { userId: ownerId },
      userId: ownerId,
    } as any);
    const widget = (await owner.create({ title: 'Open PRs' }))!.data;
    await owner.setSchedule({ id: widget.id, pattern: '0 * * * *' });
    const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
    runSandbox.mockResolvedValue(ok(5));
    await owner.dryRun({ widgetId: widget.id });
    await owner.publish({ versionId: draft.id, widgetId: widget.id });
    runSandbox.mockReset();
    const slot = new Date(Date.now() - 60_000);
    await db.update(widgets).set({ nextRunAt: slot }).where(eq(widgets.id, widget.id));
    return { slot, widget };
  };

  const scheduleRuns = (widgetId: string) =>
    db
      .select()
      .from(widgetRuns)
      .where(and(eq(widgetRuns.widgetId, widgetId), eq(widgetRuns.trigger, 'schedule')));

  const widgetRow = async (widgetId: string) =>
    (await db.select().from(widgets).where(eq(widgets.id, widgetId)))[0];

  /** Fast-forward a deferred run past its lease (and optionally its reservation age). */
  const age = (runId: string, by: { createdMs?: number; startedMs: number }) =>
    db
      .update(widgetRuns)
      .set({
        ...(by.createdMs && { createdAt: new Date(Date.now() - by.createdMs) }),
        startedAt: new Date(Date.now() - by.startedMs),
      })
      .where(eq(widgetRuns.id, runId));

  it('defers a busy run inline and resumes it from a later tick, exactly once', async () => {
    const { widget } = await dueWidget();
    runSandbox.mockRejectedValueOnce(busy()).mockResolvedValue(ok(9));

    expect(await post('/tick', {})).toMatchObject({
      claimed: 1,
      results: [{ deferred: true, widgetId: widget.id }],
    });
    const [reserved] = await scheduleRuns(widget.id);
    expect(reserved).toMatchObject({ error: null, status: 'running' });
    // The card keeps what it had: the waiting run is not reported as failed.
    expect(await widgetRow(widget.id)).toMatchObject({
      consecutiveFailures: 0,
      lastRunStatus: null,
    });

    // Within its lease the deferred run is left alone.
    expect(await post('/tick', {})).toMatchObject({ claimed: 0, resumed: 0 });
    expect(runSandbox).toHaveBeenCalledTimes(1);

    await age(reserved.id, { startedMs: 10 * 60_000 });
    expect(await post('/tick', {})).toMatchObject({
      resumed: 1,
      results: [{ runId: reserved.id, status: 'succeeded', widgetId: widget.id }],
    });
    expect(await post('/tick', {})).toMatchObject({ resumed: 0 });

    expect(runSandbox).toHaveBeenCalledTimes(2);
    expect(await scheduleRuns(widget.id)).toMatchObject([{ id: reserved.id, status: 'succeeded' }]);
    expect(await widgetRow(widget.id)).toMatchObject({
      lastRunId: reserved.id,
      lastRunStatus: 'succeeded',
      latestOutput: { type: 'stat', value: 9 },
    });
  });

  it('acks a busy queued run and resumes it through one resume message', async () => {
    vi.stubEnv('APP_URL', 'https://app.test/');
    const { slot, widget } = await dueWidget();
    const message = { slot: slot.toISOString(), widgetId: widget.id };
    runSandbox.mockRejectedValueOnce(busy()).mockResolvedValue(ok(9));

    const first = await post('/run-widget', message);
    const [reserved] = await scheduleRuns(widget.id);
    expect(first).toEqual({ deferred: true, success: true });
    expect(reserved).toMatchObject({ status: 'running' });
    // A redelivery of the slot does not run it again while it waits.
    expect(await post('/run-widget', message)).toEqual({
      skipped: 'already-claimed',
      success: true,
    });

    queueMode.enabled = true;
    const publish = vi
      .spyOn(qstashClient, 'publishJSON')
      .mockResolvedValue({ messageId: 'm1' } as never);
    expect(await post('/tick', {})).toMatchObject({ resumed: 0 });

    await age(reserved.id, { startedMs: 10 * 60_000 });
    const [{ startedAt }] = await scheduleRuns(widget.id);
    expect(await post('/tick', {})).toMatchObject({ resumed: 1 });
    const resume = {
      leaseStartedAt: startedAt.toISOString(),
      runId: reserved.id,
      widgetId: widget.id,
    };
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ body: resume }));

    // QStash delivers at least once: two copies race, one runs.
    const results = await Promise.all([post('/run-widget', resume), post('/run-widget', resume)]);
    expect(results).toEqual(
      expect.arrayContaining([
        { resumed: true, runId: reserved.id, status: 'succeeded', success: true },
        { skipped: 'not-resumable', success: true },
      ]),
    );
    expect(runSandbox).toHaveBeenCalledTimes(2);
    expect(await scheduleRuns(widget.id)).toMatchObject([{ status: 'succeeded' }]);
  });

  it('defers a resumed run again while still busy, and closes it as SANDBOX_BUSY past the deadline', async () => {
    const { widget } = await dueWidget();
    runSandbox.mockRejectedValue(busy());

    await post('/tick', {});
    const [reserved] = await scheduleRuns(widget.id);

    await age(reserved.id, { startedMs: 10 * 60_000 });
    expect(await post('/tick', {})).toMatchObject({
      resumed: 1,
      results: [{ deferred: true, runId: reserved.id }],
    });
    expect(await scheduleRuns(widget.id)).toMatchObject([{ status: 'running' }]);

    await age(reserved.id, {
      createdMs: WIDGET_BUSY_DEFER_DEADLINE_MS + 60_000,
      startedMs: 10 * 60_000,
    });
    expect(await post('/tick', {})).toMatchObject({
      resumed: 1,
      results: [{ runId: reserved.id, status: 'failed' }],
    });

    expect(runSandbox).toHaveBeenCalledTimes(3);
    expect(await scheduleRuns(widget.id)).toMatchObject([
      { error: { code: 'SANDBOX_BUSY' }, status: 'failed' },
    ]);
    expect(await widgetRow(widget.id)).toMatchObject({
      lastRunError: { code: 'SANDBOX_BUSY' },
      lastRunStatus: 'failed',
    });
    // Closed for good: nothing left for the sweep.
    expect(await post('/tick', {})).toMatchObject({ resumed: 0 });
  });
});
