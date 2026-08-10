// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, verifyRuns } from '../../schemas';
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

/** Move a run's `updated_at` back without tripping the `$onUpdate` stamp. */
const backdate = async (runId: string, ms: number) => {
  await serverDB.execute(
    sql`update ${verifyRuns} set updated_at = now() - make_interval(secs => ${ms / 1000}) where id = ${runId}`,
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
    );

    expect(stuck.map((r) => r.id).sort()).toEqual([mine, theirs].sort());
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
    await new VerifyRunModel(serverDB, userId).updateStatus(first, 'verifying');
    await new VerifyRunModel(serverDB, userId).updateStatus(second, 'verifying');
    await backdate(first, 20 * 60 * 1000);
    await backdate(second, 10 * 60 * 1000);

    const olderThan = new Date(Date.now() - 5 * 60 * 1000);
    const [head] = await VerifyRunModel.findStuckVerifying(serverDB, olderThan, { limit: 1 });
    expect(head.id).toBe(first);

    const next = await VerifyRunModel.findStuckVerifying(serverDB, olderThan, {
      after: { id: head.id, updatedAt: head.updatedAt },
      limit: 1,
    });
    expect(next.map((r) => r.id)).toEqual([second]);
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
