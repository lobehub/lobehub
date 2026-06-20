// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, users, verifyReports } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';
import { VerifyReportModel } from '../verifyReport';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-report-test-user';
const operationId = 'verify-report-test-op';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await new AgentOperationModel(serverDB, userId).recordStart({ operationId });
});

afterEach(async () => {
  await serverDB.delete(verifyReports);
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('VerifyReportModel', () => {
  it('upserts a report and reads it back by operation', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    const created = await model.upsertByOperation({
      failedChecks: 0,
      operationId,
      overallConfidence: 0.96,
      passedChecks: 5,
      summary: 'All 5 checks passed.',
      totalChecks: 5,
      uncertainChecks: 0,
      verdict: 'passed',
    });

    expect(created.verdict).toBe('passed');
    expect(created.passedChecks).toBe(5);
    expect(created.reviewedByUser).toBe(false);
    expect(created.generatedBy).toBe('system');

    const found = await model.findByOperation(operationId);
    expect(found?.id).toBe(created.id);
    expect(found?.overallConfidence).toBe(0.96);

    // a different user must not see the report
    const otherModel = new VerifyReportModel(serverDB, 'someone-else');
    expect(await otherModel.findByOperation(operationId)).toBeUndefined();
  });

  it('overwrites in place on regeneration — one report per operation', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    const first = await model.upsertByOperation({
      failedChecks: 1,
      operationId,
      passedChecks: 4,
      totalChecks: 5,
      uncertainChecks: 0,
      verdict: 'failed',
    });

    const second = await model.upsertByOperation({
      failedChecks: 0,
      operationId,
      passedChecks: 5,
      summary: 'Re-run: all green.',
      totalChecks: 5,
      uncertainChecks: 0,
      verdict: 'passed',
    });

    // same row id, updated content — the unique(operation_id) guard held
    expect(second.id).toBe(first.id);
    expect(second.verdict).toBe('passed');
    expect(second.summary).toBe('Re-run: all green.');

    const all = await serverDB.select().from(verifyReports);
    expect(all).toHaveLength(1);
  });

  it('marks a report reviewed by its operation', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    await model.upsertByOperation({
      failedChecks: 0,
      operationId,
      passedChecks: 1,
      totalChecks: 1,
      uncertainChecks: 0,
      verdict: 'passed',
    });

    await model.markReviewed(operationId);
    expect((await model.findByOperation(operationId))?.reviewedByUser).toBe(true);
  });

  it('cascades when its operation is removed', async () => {
    const model = new VerifyReportModel(serverDB, userId);
    await model.upsertByOperation({
      failedChecks: 0,
      operationId,
      passedChecks: 1,
      totalChecks: 1,
      uncertainChecks: 0,
      verdict: 'passed',
    });

    await serverDB.delete(agentOperations);
    expect(await model.findByOperation(operationId)).toBeUndefined();
  });
});
