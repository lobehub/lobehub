// @vitest-environment node
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  acceptances,
  agentOperations,
  users,
  verifyCheckResults,
  verifyRuns,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-run-query-user';
const otherUserId = 'verify-run-query-other';
const workspaceId = 'verify-run-query-ws';

const model = (owner = userId, ws?: string) => new VerifyRunModel(serverDB, owner, ws);

/** Pin `created_at` so keyset paging is deterministic down to the millisecond. */
const pinCreatedAt = async (runId: string, iso: string) => {
  await serverDB.execute(
    sql`update ${verifyRuns} set created_at = ${iso}::timestamptz where id = ${runId}`,
  );
};

const seedOperation = async (operationId: string, owner = userId, ws?: string) => {
  await serverDB
    .insert(agentOperations)
    .values({ id: operationId, status: 'running', userId: owner, workspaceId: ws });
  return operationId;
};

const titleOf = async (runId: string) => {
  const run = await serverDB.query.verifyRuns.findFirst({ where: (t, { eq }) => eq(t.id, runId) });
  return run?.title ?? null;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

describe('VerifyRunModel.query', () => {
  it('lists a bounded page newest first, scoped to the owner', async () => {
    const mine = await Promise.all([
      model().create({ title: 'oldest', source: 'agent' }),
      model().create({ title: 'middle', source: 'agent' }),
      model().create({ title: 'newest', source: 'agent' }),
    ]);
    await pinCreatedAt(mine[0].id, '2026-01-01T00:00:00.000Z');
    await pinCreatedAt(mine[1].id, '2026-01-02T00:00:00.000Z');
    await pinCreatedAt(mine[2].id, '2026-01-03T00:00:00.000Z');
    await model(otherUserId).create({ title: 'someone else', source: 'agent' });

    const rows = await model().query(2);

    expect(rows.map((row) => row.title)).toEqual(['newest', 'middle']);
    expect(rows.every((row) => row.userId === userId)).toBe(true);
  });
});

describe('VerifyRunModel.queryPage', () => {
  it('keyset-pages rows that share one millisecond without dropping any', async () => {
    const ids = [
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000b',
      '00000000-0000-4000-8000-00000000000c',
    ];
    for (const [index, id] of ids.entries()) {
      await model().create({ id, title: `tie-${index}`, source: 'agent' });
      await pinCreatedAt(id, '2026-02-01T00:00:00.000Z');
    }

    const first = await model().queryPage({ limit: 2 });

    // Same-instant rows are ordered by id, descending.
    expect(first.items.map((row) => row.id)).toEqual([ids[2], ids[1]]);
    expect(first.nextCursor).not.toBeNull();

    const second = await model().queryPage({ cursor: first.nextCursor!, limit: 2 });

    // The leftover row satisfies neither the `eq` tiebreaker nor the `lt` bound
    // unless createdAt is compared at the cursor's millisecond precision.
    expect(second.items.map((row) => row.id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
  });

  it('filters by title and treats LIKE metacharacters literally', async () => {
    await model().create({ title: 'coverage 100% restored', source: 'agent' });
    await model().create({ title: 'coverage 100x restored', source: 'agent' });
    await model().create({ title: 'unrelated round', source: 'agent' });

    const percent = await model().queryPage({ q: ' 100% ' });
    const underscore = await model().queryPage({ q: 'unrelated_round' });

    expect(percent.items.map((row) => row.title)).toEqual(['coverage 100% restored']);
    expect(underscore.items).toHaveLength(0);
  });

  it('falls back to the first page for a malformed cursor', async () => {
    await model().create({ title: 'only round', source: 'agent' });

    for (const cursor of ['no-delimiter', '__missing-timestamp', 'not-a-date__abc']) {
      const page = await model().queryPage({ cursor });
      expect(page.items.map((row) => row.title)).toEqual(['only round']);
      expect(page.nextCursor).toBeNull();
    }
  });
});

describe('VerifyRunModel.findByOperations', () => {
  it('rolls up passed/total per operation in one read', async () => {
    await seedOperation('op-rollup-1');
    await seedOperation('op-rollup-2');
    const runA = await model().create({ operationId: 'op-rollup-1', source: 'agent' });
    const runB = await model().create({ operationId: 'op-rollup-2', source: 'agent' });
    await serverDB.insert(verifyCheckResults).values([
      { checkItemId: 'a-1', userId, verdict: 'passed', verifyRunId: runA.id, verifierType: 'llm' },
      { checkItemId: 'a-2', userId, verdict: 'failed', verifyRunId: runA.id, verifierType: 'llm' },
      { checkItemId: 'b-1', userId, verdict: 'passed', verifyRunId: runB.id, verifierType: 'llm' },
    ]);

    const byOperation = await model().findByOperations(['op-rollup-1', 'op-rollup-2']);

    expect(byOperation.get('op-rollup-1')).toMatchObject({ passed: 1, total: 2 });
    expect(byOperation.get('op-rollup-2')).toMatchObject({ passed: 1, total: 1 });
    expect(byOperation.get('op-rollup-2')?.id).toBe(runB.id);
  });

  it('reports 0/0 for a run whose checks are not recorded yet', async () => {
    await seedOperation('op-rollup-empty');
    await model().create({ operationId: 'op-rollup-empty', source: 'agent' });

    const [entry] = [...(await model().findByOperations(['op-rollup-empty'])).values()];

    expect(entry).toMatchObject({ passed: 0, total: 0 });
  });

  it('ignores empty requests and operations it cannot see', async () => {
    await seedOperation('op-rollup-mine');
    await seedOperation('op-rollup-theirs', otherUserId);
    await model().create({ operationId: 'op-rollup-mine', source: 'agent' });
    await model(otherUserId).create({ operationId: 'op-rollup-theirs', source: 'agent' });

    await expect(model().findByOperations([])).resolves.toEqual(new Map());
    const byOperation = await model().findByOperations(['op-rollup-mine', 'op-rollup-theirs']);

    expect([...byOperation.keys()]).toEqual(['op-rollup-mine']);
  });
});

describe('VerifyRunModel.visibility', () => {
  it('flips one round without touching another owner', async () => {
    const mine = await model().create({ source: 'agent' });
    const theirs = await model(otherUserId).create({ source: 'agent' });

    await model().setVisibility(mine.id, 'private');
    // Target the foreign round by id too: the run-id predicate alone would
    // update it, so a missing owner check has to show up as a flipped row.
    await model().setVisibility(theirs.id, 'private');

    const reload = async (runId: string) =>
      serverDB.query.verifyRuns.findFirst({ where: (t, { eq }) => eq(t.id, runId) });
    expect((await reload(mine.id))?.visibility).toBe('private');
    expect((await reload(theirs.id))?.visibility).toBe('public');
  });

  it('cascades to every round chained to an acceptance', async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 'subject-1', subjectType: 'task', userId })
      .returning();
    const first = await model().create({ source: 'agent' });
    const second = await model().create({ source: 'agent' });
    await model().attachToAcceptance(first.id, acceptance.id);
    await model().attachToAcceptance(second.id, acceptance.id);

    await model().setVisibilityByAcceptance(acceptance.id, 'private');

    const rounds = await model().listByAcceptance(acceptance.id);
    expect(rounds.map((round) => round.visibility)).toEqual(['private', 'private']);
  });
});

describe('VerifyRunModel.appendGroupFeedback', () => {
  it('appends entries and keeps what the round already carried', async () => {
    const run = await model().create({ source: 'agent' });
    await model().setDecision(run.id, 'reject', { comment: 'first pass' });

    const first = await model().appendGroupFeedback(run.id, {
      category: '',
      comment: 'missing edge case',
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    const second = await model().appendGroupFeedback(run.id, {
      category: 'copy',
      comment: 'wording is off',
      createdAt: '2026-03-02T00:00:00.000Z',
    });

    expect(first.groupFeedback).toHaveLength(1);
    expect(second.comment).toBe('first pass');
    expect(second.groupFeedback?.map((entry) => entry.comment)).toEqual([
      'missing edge case',
      'wording is off',
    ]);
  });

  it('refuses a round it cannot see', async () => {
    const theirs = await model(otherUserId).create({ source: 'agent' });

    await expect(
      model().appendGroupFeedback(theirs.id, {
        category: '',
        comment: 'nope',
        createdAt: '2026-03-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(/not found in the current workspace/);
  });
});

describe('VerifyRunModel.claimTaskDrive', () => {
  it('claims the drive exactly once and preserves other metadata', async () => {
    const run = await model().create({ source: 'agent' });
    await model().setMetadata(run.id, { maxRepairRounds: 2 });

    await expect(model().claimTaskDrive(run.id)).resolves.toBe(true);
    await expect(model().claimTaskDrive(run.id)).resolves.toBe(false);

    const reloaded = await serverDB.query.verifyRuns.findFirst({
      where: (t, { eq }) => eq(t.id, run.id),
    });
    expect(reloaded?.metadata).toMatchObject({ maxRepairRounds: 2 });
    expect(reloaded?.metadata?.taskDrivenAt).toEqual(expect.any(String));
  });

  it("never claims another owner's round", async () => {
    const theirs = await model(otherUserId).create({ source: 'agent' });

    await expect(model().claimTaskDrive(theirs.id)).resolves.toBe(false);
  });
});

describe('VerifyRunModel.update', () => {
  it('patches the given fields and returns the updated row', async () => {
    const run = await model().create({ source: 'agent', title: 'before' });

    const updated = await model().update(run.id, { goal: 'ship it', title: 'after' });

    expect(updated).toMatchObject({ goal: 'ship it', title: 'after' });
    expect(await titleOf(run.id)).toBe('after');
  });

  it('returns undefined for an unknown or foreign round', async () => {
    const theirs = await model(otherUserId).create({ source: 'agent' });

    await expect(
      model().update('00000000-0000-4000-8000-0000000000ff', { title: 'ghost' }),
    ).resolves.toBeUndefined();
    await expect(model().update(theirs.id, { title: 'stolen' })).resolves.toBeUndefined();
    expect(await titleOf(theirs.id)).toBeNull();
  });
});

describe('VerifyRunModel.create ownership guard', () => {
  it('rejects an operation that is not visible to the caller', async () => {
    await seedOperation('op-guard-invisible', otherUserId);

    await expect(model().create({ operationId: 'op-guard-invisible' })).rejects.toThrow(
      /not found in the current workspace/,
    );
  });

  it('rejects a workspace operation created by another member', async () => {
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Verify WS', primaryOwnerId: userId, slug: 'verify-ws' });
    await seedOperation('op-guard-workspace', otherUserId, workspaceId);

    // Visible through the workspace, but reserving its unique operation_id would
    // lock the real owner out of their own round.
    await expect(
      model(userId, workspaceId).create({ operationId: 'op-guard-workspace' }),
    ).rejects.toThrow(/belongs to another member/);
  });
});

describe('VerifyRunModel draft plan guards', () => {
  const item = {
    id: 'item-1',
    index: 0,
    onFail: 'manual' as const,
    required: true,
    title: 'goal met',
    verifierConfig: {},
    verifierType: 'llm' as const,
  };

  it('refuses to set a plan on a confirmed round but lets a replace no-op', async () => {
    const run = await model().create({ source: 'agent' });
    await model().setPlan(run.id, [item]);
    await model().confirmPlan(run.id);

    await expect(model().setPlan(run.id, [{ ...item, title: 'changed' }])).rejects.toThrow(
      /Draft verification round required/,
    );
    await expect(
      model().replacePlanItems(run.id, [{ ...item, title: 'changed' }]),
    ).resolves.toBeUndefined();

    const reloaded = await serverDB.query.verifyRuns.findFirst({
      where: (t, { eq }) => eq(t.id, run.id),
    });
    expect(reloaded?.plan?.map((entry) => entry.title)).toEqual(['goal met']);
  });

  it('refuses to edit the plan of a flow round', async () => {
    const run = await model().create({ source: 'agent' });
    await serverDB.execute(
      sql`update ${verifyRuns} set flow_snapshots = '[]'::jsonb || '[{"flowId":"flow-1"}]'::jsonb where id = ${run.id}`,
    );

    await expect(model().setPlan(run.id, [item])).rejects.toThrow(/new flow round/);
  });
});
