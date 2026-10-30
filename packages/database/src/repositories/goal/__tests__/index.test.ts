// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { WidgetModel } from '../../../models/widget';
import { goalSubscriptions, users } from '../../../schemas';
import { GoalRepository } from '../index';

const db = await getTestDB();
const owner = `goal-repo-${randomUUID()}`;
const other = `goal-repo-other-${randomUUID()}`;
beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
});
afterEach(async () => {
  await db.delete(users).where(sql`${users.id} IN (${owner}, ${other})`);
});

it('rolls back the Goal transition if disabling its subscriptions fails, then fences on retry', async () => {
  const repo = new GoalRepository(db, owner);
  const goal = await repo.create({ title: 'Atomic pause', status: 'running' });
  const widget = await new WidgetModel(db, owner).create({ title: 'Shared' });
  const version = await new WidgetModel(db, owner).createVersion(widget.id, {
    script: 'console.log(1)',
    runtime: 'node',
    sourceType: 'agent',
    outputType: 'stat',
  });
  const [sub] = await db
    .insert(goalSubscriptions)
    .values({
      goalId: goal.id,
      userId: owner,
      widgetId: widget.id,
      confirmedVersionId: version!.id,
      enabled: true,
      binding: { semanticsHash: version!.contentHash },
      freshnessPolicy: { maxAgeMs: 60000, maxFutureSkewMs: 0 },
      wakeCondition: { type: 'each_valid_run' },
      cursor: { pendingWake: true },
    })
    .returning();
  await expect(
    new GoalRepository(db, other).updateStatus(goal.id, 'paused'),
  ).resolves.toBeUndefined();
  // Force the subscription write to reject while leaving the initial row valid.
  await db.execute(
    sql.raw(
      `ALTER TABLE goal_subscriptions ADD CONSTRAINT test_goal_repo_fence CHECK (id <> '${sub.id}'::uuid OR binding_revision = 1)`,
    ),
  );
  try {
    await expect(repo.updateStatus(goal.id, 'paused')).rejects.toThrow();
    expect((await repo.findById(goal.id))?.status).toBe('running');
    const [unchanged] = await db
      .select()
      .from(goalSubscriptions)
      .where(eq(goalSubscriptions.id, sub.id));
    expect(unchanged.enabled).toBe(true);
    expect(unchanged.bindingRevision).toBe(1);
    expect(unchanged.cursor.pendingWake).toBe(true);
  } finally {
    await db.execute(sql`ALTER TABLE goal_subscriptions DROP CONSTRAINT test_goal_repo_fence`);
  }
  await repo.updateStatus(goal.id, 'paused');
  expect((await repo.findById(goal.id))?.status).toBe('paused');
  const [stopped] = await db
    .select()
    .from(goalSubscriptions)
    .where(eq(goalSubscriptions.id, sub.id));
  expect(stopped.enabled).toBe(false);
  expect(stopped.bindingRevision).toBe(2);
  expect(stopped.cursor.pendingWake).toBeUndefined();
});
