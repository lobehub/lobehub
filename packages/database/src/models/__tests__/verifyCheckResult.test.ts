// @vitest-environment node
import type { VerifyCheckItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  llmGenerationTracing,
  users,
  verifyCheckResults,
  verifyRuns,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';
import { VerifyCheckResultModel } from '../verifyCheckResult';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-result-test-user';
const operationId = 'verify-result-test-op';

/** Resolved in beforeEach — the session every result row hangs off. */
let verifyRunId: string;

const buildItem = (overrides: Partial<VerifyCheckItem> = {}): VerifyCheckItem => ({
  id: 'item-1',
  index: 0,
  onFail: 'manual',
  required: true,
  title: 'goal met',
  verifierConfig: {},
  verifierType: 'llm',
  ...overrides,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await new AgentOperationModel(serverDB, userId).recordStart({ operationId });
  const run = await new VerifyRunModel(serverDB, userId).ensureForOperation(operationId);
  verifyRunId = run.id;
});

afterEach(async () => {
  await serverDB.delete(verifyCheckResults);
  await serverDB.delete(llmGenerationTracing);
  await serverDB.delete(verifyRuns);
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('VerifyCheckResultModel', () => {
  it('batch-inserts pending rows and lists by run in index order', async () => {
    const model = new VerifyCheckResultModel(serverDB, userId);
    await model.createMany([
      { checkItemId: 'b', checkItemIndex: 1, verifierType: 'llm', verifyRunId },
      { checkItemId: 'a', checkItemIndex: 0, verifierType: 'llm', verifyRunId },
    ]);

    const rows = await model.listByRun(verifyRunId);
    expect(rows.map((r) => r.checkItemId)).toEqual(['a', 'b']);
    expect(rows[0].status).toBe('pending');
  });

  it('createMany returns an empty array without inserting when given no rows', async () => {
    const model = new VerifyCheckResultModel(serverDB, userId);
    const result = await model.createMany([]);
    expect(result).toEqual([]);
    expect(await model.listByRun(verifyRunId)).toHaveLength(0);
  });

  it('findById returns the matching row scoped to the user and undefined otherwise', async () => {
    const model = new VerifyCheckResultModel(serverDB, userId);
    const created = await model.create({
      checkItemId: 'a',
      checkItemIndex: 0,
      verifierType: 'llm',
      verifyRunId,
    });

    const found = await model.findById(created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.checkItemId).toBe('a');

    // a different user must not see the row
    const otherModel = new VerifyCheckResultModel(serverDB, 'someone-else');
    expect(await otherModel.findById(created.id)).toBeUndefined();

    // a valid-but-absent uuid resolves to undefined
    expect(await model.findById('00000000-0000-0000-0000-000000000000')).toBeUndefined();
  });

  it('update mutates a row by its id', async () => {
    const model = new VerifyCheckResultModel(serverDB, userId);
    const created = await model.create({
      checkItemId: 'a',
      checkItemIndex: 0,
      verifierType: 'llm',
      verifyRunId,
    });

    await model.update(created.id, { status: 'failed', verdict: 'failed' });

    const row = await model.findById(created.id);
    expect(row).toMatchObject({ status: 'failed', verdict: 'failed' });
  });

  it('backfillTracingId fills NULL tracing ids for the named items only and is idempotent', async () => {
    const model = new VerifyCheckResultModel(serverDB, userId);
    const [tracing] = await serverDB
      .insert(llmGenerationTracing)
      .values({
        promptHash: 'hash',
        promptVersion: 'v1',
        scenario: 'verify',
        success: true,
        userId,
      })
      .returning();

    await model.createMany([
      { checkItemId: 'a', checkItemIndex: 0, verifierType: 'llm', verifyRunId },
      { checkItemId: 'b', checkItemIndex: 1, verifierType: 'llm', verifyRunId },
    ]);

    // empty checkItemIds short-circuits (returns undefined, writes nothing)
    expect(await model.backfillTracingId(verifyRunId, [], tracing.id)).toBeUndefined();
    expect((await model.listByRun(verifyRunId)).every((r) => r.verifierTracingId === null)).toBe(
      true,
    );

    await model.backfillTracingId(verifyRunId, ['a'], tracing.id);

    const after = await model.listByRun(verifyRunId);
    const a = after.find((r) => r.checkItemId === 'a');
    const b = after.find((r) => r.checkItemId === 'b');
    expect(a?.verifierTracingId).toBe(tracing.id);
    // 'b' was not in the list → untouched
    expect(b?.verifierTracingId).toBeNull();

    // idempotent: re-running only fills NULLs, so 'a' keeps its existing id
    await model.backfillTracingId(verifyRunId, ['a'], tracing.id);
    const reloaded = await model.findById(a!.id);
    expect(reloaded?.verifierTracingId).toBe(tracing.id);
  });

  it('updates a result by its stable (verifyRunId, checkItemId) key', async () => {
    const model = new VerifyCheckResultModel(serverDB, userId);
    await model.create({ checkItemId: 'a', checkItemIndex: 0, verifierType: 'llm', verifyRunId });

    await model.updateByCheckItem(verifyRunId, 'a', {
      confidence: 0.9,
      status: 'passed',
      toulmin: { evidence: 'tests passed', reasoning: 'covers the goal' },
      verdict: 'passed',
    });

    const [row] = await model.listByRun(verifyRunId);
    expect(row).toMatchObject({ confidence: 0.9, status: 'passed', verdict: 'passed' });
    expect(row.toulmin).toEqual({ evidence: 'tests passed', reasoning: 'covers the goal' });
  });
});

describe('VerifyRunModel plan', () => {
  it('sets a draft plan and flips rollup to planned', async () => {
    const model = new VerifyRunModel(serverDB, userId);
    await model.setPlan(verifyRunId, [buildItem()]);

    const state = await model.getState(verifyRunId);
    expect(state?.verifyStatus).toBe('planned');
    expect(state?.verifyPlan).toHaveLength(1);
    expect(state?.verifyPlanConfirmedAt).toBeNull();
  });

  it('allows editing a draft plan but not after confirmation', async () => {
    const model = new VerifyRunModel(serverDB, userId);
    await model.setPlan(verifyRunId, [buildItem({ title: 'draft' })]);

    await model.replacePlanItems(verifyRunId, [buildItem({ title: 'edited' })]);
    expect((await model.getState(verifyRunId))?.verifyPlan?.[0].title).toBe('edited');

    await model.confirmPlan(verifyRunId);
    await model.replacePlanItems(verifyRunId, [buildItem({ title: 'too late' })]);
    expect((await model.getState(verifyRunId))?.verifyPlan?.[0].title).toBe('edited');
  });

  it('updates the rollup status', async () => {
    const model = new VerifyRunModel(serverDB, userId);
    await model.setPlan(verifyRunId, [buildItem()]);
    await model.updateStatus(verifyRunId, 'passed');
    expect((await model.getState(verifyRunId))?.verifyStatus).toBe('passed');
  });

  it('resolves the same session for an operation (ensureForOperation is idempotent)', async () => {
    const model = new VerifyRunModel(serverDB, userId);
    const again = await model.ensureForOperation(operationId);
    expect(again.id).toBe(verifyRunId);
    expect((await model.findByOperation(operationId))?.id).toBe(verifyRunId);
  });
});
