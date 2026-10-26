// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { goals, goalSubscriptions, users } from '../../schemas';
import { GoalSubscriptionModel } from '../goalSubscription';
import { WidgetModel } from '../widget';

const db = await getTestDB();
const owner = `subscription-model-${randomUUID()}`;
beforeEach(async () => {
  await db.insert(users).values({ id: owner });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, owner));
});

it('disables only the owning Goal bindings and preserves accepted history', async () => {
  const widget = await new WidgetModel(db, owner).create({ title: 'Shared' });
  const version = await new WidgetModel(db, owner).createVersion(widget.id, {
    script: 'console.log(1)',
    runtime: 'node',
    sourceType: 'agent',
    outputType: 'stat',
  });
  const roots = await db
    .insert(goals)
    .values([
      { userId: owner, title: 'First' },
      { userId: owner, title: 'Second' },
    ])
    .returning();
  const cursor = { pendingWake: true, lastWakeAt: new Date().toISOString() };
  const rows = await db
    .insert(goalSubscriptions)
    .values(
      roots.map((goal) => ({
        goalId: goal.id,
        userId: owner,
        widgetId: widget.id,
        confirmedVersionId: version!.id,
        enabled: true,
        binding: { semanticsHash: version!.contentHash },
        freshnessPolicy: { maxAgeMs: 60000, maxFutureSkewMs: 0 },
        wakeCondition: { type: 'each_valid_run' as const },
        cursor,
      })),
    )
    .returning();
  await new GoalSubscriptionModel(db).disableForGoal(roots[0].id);
  await new GoalSubscriptionModel(db).disableForGoal(roots[0].id);
  const [stopped] = await db
    .select()
    .from(goalSubscriptions)
    .where(eq(goalSubscriptions.id, rows[0].id));
  const [shared] = await db
    .select()
    .from(goalSubscriptions)
    .where(eq(goalSubscriptions.id, rows[1].id));
  expect(stopped.enabled).toBe(false);
  expect(stopped.bindingRevision).toBe(2);
  expect(stopped.cursor).toEqual({ lastWakeAt: cursor.lastWakeAt });
  expect(shared.enabled).toBe(true);
  expect(shared.bindingRevision).toBe(1);
  expect(shared.cursor).toEqual(cursor);
});
