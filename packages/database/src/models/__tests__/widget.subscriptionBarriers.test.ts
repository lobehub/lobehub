// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, widgetRuns, widgets } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { CreateWidgetVersionInput } from '../widget';
import { WidgetModel } from '../widget';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'widget-barrier-user';

const script = (n: number): CreateWidgetVersionInput => ({
  manifest: { network: { allow: ['api.github.com'] }, title: `v${n}` },
  outputType: 'stat',
  runtime: 'node',
  script: `console.log(JSON.stringify({ type: 'stat', value: ${n} }))`,
  sourceType: 'agent',
  view: { size: 'sm' },
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

/**
 * The producer side of Goal Widget subscriptions: a run's completion and its
 * metric publication commit together, and a reservation takes its timestamp
 * only after the subscription scanner's Widget lock.
 */
describe('WidgetModel subscription producer barriers', () => {
  const model = new WidgetModel(serverDB, userId);

  it('keeps completion and metric publication atomic on failure', async () => {
    const widget = await model.create({ title: 'Atomic metric publication' });
    const version = await model.createVersion(widget.id, script(1));
    await model.publishVersion(widget.id, version!.id);
    const run = await model.startRun(widget.id, { trigger: 'manual' });
    await expect(
      WidgetModel.finishRun(
        serverDB,
        run!.id,
        { status: 'succeeded', output: { type: 'stat', value: 1 } },
        async () => {
          throw new Error('metric storage failure');
        },
      ),
    ).rejects.toThrow('metric storage failure');
    const [stored] = await serverDB.select().from(widgetRuns).where(eq(widgetRuns.id, run!.id));
    expect(stored.status).toBe('running');
    expect((await model.findById(widget.id))?.lastRunId).toBeNull();
  });

  it.skipIf(process.env.TEST_SERVER_DB !== '1')(
    'allocates reservation timestamps after waiting for the scanner Widget lock',
    async () => {
      const widget = await model.create({ title: 'Delayed reservation' });
      const version = await model.createVersion(widget.id, script(1));
      await model.publishVersion(widget.id, version!.id);
      let release!: () => void;
      let locked!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let scannerTime = '';
      const scanner = serverDB.transaction(async (tx) => {
        await tx.select().from(widgets).where(eq(widgets.id, widget.id)).for('update');
        locked();
        await held;
        const result = await tx.execute(sql`SELECT clock_timestamp()::text AS timestamp`);
        scannerTime = result.rows[0].timestamp as string;
      });
      await ready;
      // Begin while the scanner holds the row; without producer serialization
      // this reservation completes before the scanner releases its watermark.
      const reservation = model.startRun(widget.id, { trigger: 'manual' });
      await serverDB.execute(sql`SELECT pg_sleep(0.05)`);
      release();
      await scanner;
      const run = await reservation;
      const result = await serverDB.execute(
        sql`SELECT created_at > ${scannerTime}::timestamptz AS after_scan FROM widget_runs WHERE id = ${run!.id}::uuid`,
      );
      expect(result.rows[0].after_scan).toBe(true);
    },
  );
});
