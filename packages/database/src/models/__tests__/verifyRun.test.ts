// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, users, verifyRuns } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-run-test-user';
const otherUserId = 'verify-run-test-other';

const buildRun = async (operationId: string, owner = userId) => {
  await new AgentOperationModel(serverDB, owner).recordStart({ operationId });
  const run = await new VerifyRunModel(serverDB, owner).ensureForOperation(operationId);
  await new VerifyRunModel(serverDB, owner).setPlan(run.id, [
    {
      id: 'item-1',
      index: 0,
      onFail: 'manual',
      required: true,
      title: 'goal met',
      verifierConfig: {},
      verifierType: 'llm',
    },
  ]);
  return run.id;
};

/**
 * Move a run's `updated_at` back without tripping the `$onUpdate` stamp.
 *
 * Deliberately lands on a sub-millisecond remainder (`.xxx456`). `timestamptz`
 * holds microseconds while a cursor read back through a JS `Date` carries only
 * milliseconds, so a keyset that compares the raw column against the cursor
 * fails exactly on rows like these — and `now()` produces one only by chance,
 * which is how the bug reached CI green locally.
 */
const backdate = async (runId: string, ms: number) => {
  await serverDB.execute(
    sql`update ${verifyRuns}
        set updated_at = date_trunc('second', now())
                       - make_interval(secs => ${ms / 1000})
                       + interval '123456 microseconds'
        where id = ${runId}`,
  );
};

const statusOf = async (runId: string) => {
  const [row] = await serverDB
    .select({ status: verifyRuns.status })
    .from(verifyRuns)
    .where(eq(verifyRuns.id, runId));
  return row?.status ?? null;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

describe('VerifyRunModel.claimVerifying', () => {
  const staleBefore = () => new Date(Date.now() - 30 * 60 * 1000);

  it('claims a planned run and enters verifying', async () => {
    const runId = await buildRun('op-claim-1');

    await expect(
      new VerifyRunModel(serverDB, userId).claimVerifying(runId, staleBefore()),
    ).resolves.toBe(true);
    expect(await statusOf(runId)).toBe('verifying');
  });

  it('advances a builder evidence run into verifying', async () => {
    const runId = await buildRun('op-claim-evidence');
    const model = new VerifyRunModel(serverDB, userId);
    await expect(model.claimEvidenceCollection(runId)).resolves.toBe(true);
    expect(await statusOf(runId)).toBe('collecting_evidence');

    await expect(model.claimVerifying(runId, staleBefore())).resolves.toBe(true);
    expect(await statusOf(runId)).toBe('verifying');
  });

  it('reserves evidence collection exactly once', async () => {
    const runId = await buildRun('op-evidence-once');
    const model = new VerifyRunModel(serverDB, userId);

    await expect(model.claimEvidenceCollection(runId)).resolves.toBe(true);
    await expect(model.claimEvidenceCollection(runId)).resolves.toBe(false);
  });

  it('refuses a second claim while the first is still working', async () => {
    const runId = await buildRun('op-claim-2');
    const model = new VerifyRunModel(serverDB, userId);
    await model.claimVerifying(runId, staleBefore());

    // A redelivered completion must not start a second judge pass over the same plan.
    await expect(model.claimVerifying(runId, staleBefore())).resolves.toBe(false);
  });

  it('re-claims a verifying run abandoned before the stale bound', async () => {
    // The bug this exists for: an attempt entered `verifying` and died mid-judge.
    // The old `status === 'planned'` gate read its own leftover write and shut
    // out every retry, stranding the run in `verifying` for good.
    const runId = await buildRun('op-claim-3');
    const model = new VerifyRunModel(serverDB, userId);
    await model.claimVerifying(runId, staleBefore());
    await backdate(runId, 31 * 60 * 1000);

    await expect(model.claimVerifying(runId, staleBefore())).resolves.toBe(true);
  });

  it('never claims a settled run', async () => {
    const runId = await buildRun('op-claim-4');
    const model = new VerifyRunModel(serverDB, userId);
    await model.updateStatus(runId, 'failed');
    await backdate(runId, 31 * 60 * 1000);

    await expect(model.claimVerifying(runId, staleBefore())).resolves.toBe(false);
    expect(await statusOf(runId)).toBe('failed');
  });

  it('does not claim another owner’s run', async () => {
    const runId = await buildRun('op-claim-5', otherUserId);

    await expect(
      new VerifyRunModel(serverDB, userId).claimVerifying(runId, staleBefore()),
    ).resolves.toBe(false);
    expect(await statusOf(runId)).toBe('planned');
  });
});

/**
 * `findStuckVerifying` is deliberately global — no user or workspace scope, since
 * it backs a cross-owner cron. The test database is shared with every other suite,
 * so these assertions state what must be true of *our* rows (present / absent /
 * ordered) and never that a page equals exactly them: any stranded row another
 * suite left behind is legitimately part of the same result.
 */
describe('VerifyRunModel.findStuckVerifying', () => {
  it('returns verifying runs older than the bound, across owners', async () => {
    const mine = await buildRun('op-stuck-1');
    const theirs = await buildRun('op-stuck-2', otherUserId);
    await new VerifyRunModel(serverDB, userId).updateStatus(mine, 'verifying');
    await new VerifyRunModel(serverDB, otherUserId).updateStatus(theirs, 'verifying');
    await backdate(mine, 10 * 60 * 1000);
    await backdate(theirs, 10 * 60 * 1000);

    const stuck = await VerifyRunModel.findStuckVerifying(
      serverDB,
      new Date(Date.now() - 5 * 60 * 1000),
      { limit: 500 },
    );

    // Both owners' runs, from a query given neither owner.
    expect(stuck.map((r) => r.id)).toEqual(expect.arrayContaining([mine, theirs]));
  });

  it('leaves a freshly-entered run alone', async () => {
    const runId = await buildRun('op-stuck-3');
    await new VerifyRunModel(serverDB, userId).updateStatus(runId, 'verifying');

    const stuck = await VerifyRunModel.findStuckVerifying(
      serverDB,
      new Date(Date.now() - 5 * 60 * 1000),
    );

    expect(stuck.map((r) => r.id)).not.toContain(runId);
  });

  it('ignores runs in any other status', async () => {
    const runId = await buildRun('op-stuck-4');
    await new VerifyRunModel(serverDB, userId).updateStatus(runId, 'repairing');
    await backdate(runId, 10 * 60 * 1000);

    const stuck = await VerifyRunModel.findStuckVerifying(
      serverDB,
      new Date(Date.now() - 5 * 60 * 1000),
    );

    expect(stuck.map((r) => r.id)).not.toContain(runId);
  });

  it('resumes after the cursor so unrecoverable rows cannot starve newer ones', async () => {
    // The sweep leaves some rows untouched, and an untouched row keeps its
    // timestamp. Paging past it is the only thing that lets the scan reach the
    // runs behind it.
    const first = await buildRun('op-page-1');
    const second = await buildRun('op-page-2');
    // A third stranded run belonging to someone else, landing between the two —
    // the scan is global, so the cursor has to be right about ours regardless of
    // what else shares the window.
    const interloper = await buildRun('op-page-3', otherUserId);
    await new VerifyRunModel(serverDB, userId).updateStatus(first, 'verifying');
    await new VerifyRunModel(serverDB, userId).updateStatus(second, 'verifying');
    await new VerifyRunModel(serverDB, otherUserId).updateStatus(interloper, 'verifying');
    await backdate(first, 20 * 60 * 1000);
    await backdate(interloper, 15 * 60 * 1000);
    await backdate(second, 10 * 60 * 1000);

    const olderThan = new Date(Date.now() - 5 * 60 * 1000);
    const scan = await VerifyRunModel.findStuckVerifying(serverDB, olderThan, { limit: 500 });
    const ids = scan.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([first, second]));
    // Oldest first, so the cursor has something to advance past.
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));

    const cursor = scan[ids.indexOf(first)];
    const rest = await VerifyRunModel.findStuckVerifying(serverDB, olderThan, {
      after: { id: cursor.id, updatedAt: cursor.updatedAt },
      limit: 500,
    });
    const restIds = rest.map((r) => r.id);

    // The whole point: the cursor drops what it already saw and still reaches
    // everything behind it — the row it advanced past cannot starve the rest.
    expect(restIds).not.toContain(first);
    expect(restIds).toContain(second);
    // Guards the guard: if the interloper stopped landing inside the window this
    // test would quietly stop covering the contaminated case it exists for.
    expect(restIds).toContain(interloper);
  });

  it('ignores operation-less rounds — there is no rollup to address', async () => {
    const run = await new VerifyRunModel(serverDB, userId).create({ status: 'verifying' });
    await backdate(run.id, 10 * 60 * 1000);

    const stuck = await VerifyRunModel.findStuckVerifying(
      serverDB,
      new Date(Date.now() - 5 * 60 * 1000),
    );

    expect(stuck.map((r) => r.id)).not.toContain(run.id);
  });
});

describe('VerifyRunModel.foldIntoRound', () => {
  const model = () => new VerifyRunModel(serverDB, userId);
  const item = (id: string) => ({
    id,
    index: 0,
    onFail: 'manual' as const,
    required: true,
    title: id,
    verifierConfig: {},
    verifierType: 'agent' as const,
  });
  const draftRound = async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ userId, subjectType: 'standalone', subjectId: 'fold-subject' })
      .returning();
    const draft = await model().create({
      acceptanceId: acceptance.id,
      plan: [item('flow-1')],
      roundIndex: 1,
      status: 'planned',
      title: 'draft',
    });
    return { acceptance, draft };
  };

  it('folds a detached harness run into the draft and removes the extra row', async () => {
    const { acceptance, draft } = await draftRound();
    const incoming = await model().create({
      metadata: { interactionCost: { total: 1 } } as any,
      plan: [item('case-1'), item('flow-1')],
      source: 'agent-testing',
      title: 'harness',
    });

    const folded = await model().foldIntoRound(incoming.id, draft.id);

    expect(folded.id).toBe(draft.id);
    expect(folded.roundIndex).toBe(1);
    expect(folded.plan?.map((p) => [p.id, p.index])).toEqual([
      ['flow-1', 0],
      ['case-1', 1],
    ]);
    expect(folded.status).toBeNull();
    expect(folded.planConfirmedAt).not.toBeNull();
    expect(folded.source).toBe('agent-testing');
    expect(folded.metadata).toMatchObject({ interactionCost: { total: 1 } });
    expect(await model().findById(incoming.id)).toBeUndefined();
    expect(await model().listByAcceptance(acceptance.id)).toHaveLength(1);
  });

  it('refuses to fold into a round that already executed or a run already chained', async () => {
    const { acceptance, draft } = await draftRound();
    await model().confirmPlan(draft.id);
    const incoming = await model().create({ plan: [item('case-1')], title: 'harness' });
    await expect(model().foldIntoRound(incoming.id, draft.id)).rejects.toThrow('draft round');

    const chained = await model().create({
      acceptanceId: acceptance.id,
      plan: [item('case-2')],
      roundIndex: 2,
      title: 'chained',
    });
    await expect(model().foldIntoRound(chained.id, draft.id)).rejects.toThrow('detached');
  });
});
