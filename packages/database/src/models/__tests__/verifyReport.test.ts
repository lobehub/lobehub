// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, users, verifyReports, verifyRuns } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';
import { VerifyReportModel } from '../verifyReport';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-report-test-user';
const operationId = 'verify-report-test-op';

/** Resolved in beforeEach — the session each report summarizes. */
let verifyRunId: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await new AgentOperationModel(serverDB, userId).recordStart({ operationId });
  const run = await new VerifyRunModel(serverDB, userId).ensureForOperation(operationId);
  verifyRunId = run.id;
});

afterEach(async () => {
  await serverDB.delete(verifyReports);
  await serverDB.delete(verifyRuns);
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('VerifyReportModel', () => {
  it('upserts a report and reads it back by run', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    const created = await model.upsertByRun({
      failedChecks: 0,
      overallConfidence: 0.96,
      passedChecks: 5,
      summary: 'All 5 checks passed.',
      totalChecks: 5,
      uncertainChecks: 0,
      verdict: 'passed',
      verifyRunId,
    });

    expect(created.verdict).toBe('passed');
    expect(created.passedChecks).toBe(5);
    expect(created.reviewedByUser).toBe(false);
    expect(created.generatedBy).toBe('system');

    const found = await model.findByRun(verifyRunId);
    expect(found?.id).toBe(created.id);
    expect(found?.overallConfidence).toBe(0.96);

    // a different user must not see the report
    const otherModel = new VerifyReportModel(serverDB, 'someone-else');
    expect(await otherModel.findByRun(verifyRunId)).toBeUndefined();
  });

  it('overwrites in place on regeneration — one report per run', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    const first = await model.upsertByRun({
      failedChecks: 1,
      passedChecks: 4,
      totalChecks: 5,
      uncertainChecks: 0,
      verdict: 'failed',
      verifyRunId,
    });

    const second = await model.upsertByRun({
      failedChecks: 0,
      passedChecks: 5,
      summary: 'Re-run: all green.',
      totalChecks: 5,
      uncertainChecks: 0,
      verdict: 'passed',
      verifyRunId,
    });

    // same row id, updated content — the unique(verify_run_id) guard held
    expect(second.id).toBe(first.id);
    expect(second.verdict).toBe('passed');
    expect(second.summary).toBe('Re-run: all green.');

    const all = await serverDB.select().from(verifyReports);
    expect(all).toHaveLength(1);
  });

  it('rejects upserting a report for another user run without re-owning it', async () => {
    const otherUserId = 'verify-report-other-user';
    const otherOperationId = 'verify-report-other-op';
    await serverDB.insert(users).values([{ id: otherUserId }]);
    await new AgentOperationModel(serverDB, otherUserId).recordStart({
      operationId: otherOperationId,
    });
    const otherRun = await new VerifyRunModel(serverDB, otherUserId).ensureForOperation(
      otherOperationId,
    );
    const otherModel = new VerifyReportModel(serverDB, otherUserId);
    const original = await otherModel.upsertByRun({
      failedChecks: 1,
      passedChecks: 0,
      summary: 'Original owner report',
      totalChecks: 1,
      uncertainChecks: 0,
      verdict: 'failed',
      verifyRunId: otherRun.id,
    });

    await expect(
      new VerifyReportModel(serverDB, userId).upsertByRun({
        failedChecks: 0,
        passedChecks: 1,
        summary: 'Attacker report',
        totalChecks: 1,
        uncertainChecks: 0,
        verdict: 'passed',
        verifyRunId: otherRun.id,
      }),
    ).rejects.toThrow('not found in the current workspace');

    const reloaded = await otherModel.findByRun(otherRun.id);
    expect(reloaded).toMatchObject({
      id: original.id,
      summary: 'Original owner report',
      userId: otherUserId,
      verdict: 'failed',
    });
    expect(await new VerifyReportModel(serverDB, userId).findByRun(otherRun.id)).toBeUndefined();
  });

  it('marks a report reviewed by its run', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    await model.upsertByRun({
      failedChecks: 0,
      passedChecks: 1,
      totalChecks: 1,
      uncertainChecks: 0,
      verdict: 'passed',
      verifyRunId,
    });

    await model.markReviewed(verifyRunId);
    expect((await model.findByRun(verifyRunId))?.reviewedByUser).toBe(true);
  });

  it('survives deletion of the linked Agent Run (decoupled from agent_operations)', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    await model.upsertByRun({
      failedChecks: 0,
      passedChecks: 1,
      totalChecks: 1,
      uncertainChecks: 0,
      verdict: 'passed',
      verifyRunId,
    });

    // Deleting the operation only nulls verify_runs.operation_id; the session and
    // its report live on.
    await serverDB.delete(agentOperations);
    expect((await model.findByRun(verifyRunId))?.id).toBeDefined();
  });

  it('cascades when its verification session is removed', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    await model.upsertByRun({
      failedChecks: 0,
      passedChecks: 1,
      totalChecks: 1,
      uncertainChecks: 0,
      verdict: 'passed',
      verifyRunId,
    });

    await new VerifyRunModel(serverDB, userId).delete(verifyRunId);
    expect(await model.findByRun(verifyRunId)).toBeUndefined();
  });
});
