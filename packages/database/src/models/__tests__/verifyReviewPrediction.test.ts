// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  users,
  verifyCheckResults,
  verifyReviewPredictions,
  verifyRuns,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';
import { VerifyCheckResultModel } from '../verifyCheckResult';
import { VerifyReviewPredictionModel } from '../verifyReviewPrediction';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-prediction-test-user';
const operationId = 'verify-prediction-test-op';

const identity = { model: 'gemini-3.6-flash', promptVersion: 'v1', provider: 'google' };

let resultIds: string[];
let runId: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await new AgentOperationModel(serverDB, userId).recordStart({ operationId });
  const run = await new VerifyRunModel(serverDB, userId).ensureForOperation(operationId);
  runId = run.id;
  const rows = await new VerifyCheckResultModel(serverDB, userId).createMany([
    { checkItemId: 'a', checkItemIndex: 0, verifierType: 'llm', verifyRunId: run.id },
    { checkItemId: 'b', checkItemIndex: 1, verifierType: 'llm', verifyRunId: run.id },
  ]);
  resultIds = rows.map((r) => r.id);
});

afterEach(async () => {
  await serverDB.delete(verifyReviewPredictions);
  await serverDB.delete(verifyCheckResults);
  await serverDB.delete(verifyRuns);
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('VerifyReviewPredictionModel.resetUnadjudicated', () => {
  /**
   * Regression: a re-request left the previous batch's rows in place until each
   * replacement upserted over them, so a poller waiting for "every check has a
   * recorded attempt" saw that condition met on its first tick. The reset must
   * clear the unanswered rows of the current reviewer — and only those.
   */
  it('clears unanswered rows of the same reviewer and keeps adjudicated ones', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    const unanswered = await model.upsert({
      action: 'accept',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
    });
    const answered = await model.upsert({
      action: 'reject',
      checkResultId: resultIds[1],
      status: 'judged',
      ...identity,
    });
    await model.adjudicate(answered.id, { adjudication: 'not-an-issue' });

    await model.resetUnadjudicated(resultIds, identity);

    expect(await model.findById(unanswered.id)).toBeUndefined();
    expect((await model.findById(answered.id))?.adjudication).toBe('not-an-issue');
  });

  it('leaves rows from another model or prompt version untouched', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    const otherModel = await model.upsert({
      action: 'accept',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
      model: 'deepseek-v4-pro',
    });
    const otherPrompt = await model.upsert({
      action: 'accept',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
      promptVersion: 'v0',
    });

    await model.resetUnadjudicated(resultIds, identity);

    expect(await model.findById(otherModel.id)).toBeDefined();
    expect(await model.findById(otherPrompt.id)).toBeDefined();
  });

  it('is a no-op for an empty id list', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    const row = await model.upsert({
      action: 'accept',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
    });

    await model.resetUnadjudicated([], identity);

    expect(await model.findById(row.id)).toBeDefined();
  });
});

describe('VerifyReviewPredictionModel.upsert', () => {
  it('replaces the previous opinion in place and clears the stale adjudication', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    const first = await model.upsert({
      action: 'accept',
      checkResultId: resultIds[0],
      comment: 'looks good',
      confidence: 0.9,
      status: 'judged',
      ...identity,
    });
    await model.adjudicate(first.id, { adjudication: 'confirmed', edit: 'verbatim' });

    // A re-run that produced no verdict must land on the same row and drop the previous
    // action / comment / adjudication, instead of stacking a second vote.
    const replacement = await model.upsert({
      checkResultId: resultIds[0],
      status: 'skipped',
      statusReason: 'no frame to look at',
      ...identity,
    });

    expect(replacement.id).toBe(first.id);
    expect(replacement.status).toBe('skipped');
    expect(replacement.action).toBeNull();
    expect(replacement.comment).toBeNull();
    expect(replacement.confidence).toBeNull();
    expect(replacement.adjudication).toBeNull();
    expect(replacement.adjudicatedAt).toBeNull();
    expect(replacement.adjudicationEdit).toBeNull();
    expect(replacement.statusReason).toBe('no frame to look at');
    expect(await model.listByCheckResult(resultIds[0])).toHaveLength(1);
  });
});

describe('VerifyReviewPredictionModel.adjudicate', () => {
  it('does not answer a proposal the caller cannot see', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    const row = await model.upsert({
      action: 'reject',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
    });

    const otherModel = new VerifyReviewPredictionModel(serverDB, 'someone-else');
    expect(await otherModel.adjudicate(row.id, { adjudication: 'confirmed' })).toBeUndefined();

    expect((await model.findById(row.id))?.adjudication).toBeNull();
  });
});

describe('VerifyReviewPredictionModel.findAdjudicated', () => {
  it('returns the answered proposal only for the exact result + model identity', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    const row = await model.upsert({
      action: 'accept',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
    });

    // an unanswered proposal is not a recorded label
    expect(
      await model.findAdjudicated(
        resultIds[0],
        identity.provider,
        identity.model,
        identity.promptVersion,
      ),
    ).toBeUndefined();

    await model.adjudicate(row.id, { adjudication: 'not-an-issue' });

    const found = await model.findAdjudicated(
      resultIds[0],
      identity.provider,
      identity.model,
      identity.promptVersion,
    );
    expect(found?.id).toBe(row.id);

    // any other identity axis misses the label
    expect(
      await model.findAdjudicated(resultIds[0], identity.provider, identity.model, 'v0'),
    ).toBeUndefined();
    expect(
      await model.findAdjudicated(resultIds[0], identity.provider, 'other-model', 'v1'),
    ).toBeUndefined();
    expect(
      await model.findAdjudicated(resultIds[0], 'openai', identity.model, 'v1'),
    ).toBeUndefined();
    expect(
      await model.findAdjudicated(resultIds[1], identity.provider, identity.model, 'v1'),
    ).toBeUndefined();

    // ownership: another user never sees the label
    const otherModel = new VerifyReviewPredictionModel(serverDB, 'someone-else');
    expect(
      await otherModel.findAdjudicated(
        resultIds[0],
        identity.provider,
        identity.model,
        identity.promptVersion,
      ),
    ).toBeUndefined();
  });
});

describe('VerifyReviewPredictionModel.listByRuns', () => {
  it('is a no-op for an empty run list', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    expect(await model.listByRuns([])).toEqual([]);
  });

  it('annotates every opinion with its check item and run', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    await model.upsert({
      action: 'accept',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
    });
    await model.upsert({
      action: 'reject',
      checkResultId: resultIds[1],
      status: 'judged',
      ...identity,
      model: 'deepseek-v4-pro',
    });

    const rows = await model.listByRuns([runId]);
    expect(rows).toHaveLength(2);
    expect([...rows.map((r) => r.checkItemId)].sort()).toEqual(['a', 'b']);
    expect(rows.every((r) => r.verifyRunId === runId)).toBe(true);

    const otherModel = new VerifyReviewPredictionModel(serverDB, 'someone-else');
    expect(await otherModel.listByRuns([runId])).toEqual([]);
  });

  it('returns nothing for a run that has no predictions', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    expect(await model.listByRuns(['00000000-0000-0000-0000-000000000000'])).toEqual([]);
  });
});

describe('VerifyReviewPredictionModel.listByCheckResult', () => {
  it('returns every opinion recorded on a result, scoped to the caller', async () => {
    const model = new VerifyReviewPredictionModel(serverDB, userId);
    await model.upsert({
      action: 'accept',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
    });
    await model.upsert({
      action: 'unjudgeable',
      checkResultId: resultIds[0],
      status: 'judged',
      ...identity,
      model: 'deepseek-v4-pro',
    });

    const rows = await model.listByCheckResult(resultIds[0]);
    expect(rows).toHaveLength(2);
    expect([...rows.map((r) => r.model)].sort()).toEqual(['deepseek-v4-pro', 'gemini-3.6-flash']);

    expect(await model.listByCheckResult(resultIds[1])).toHaveLength(0);

    const otherModel = new VerifyReviewPredictionModel(serverDB, 'someone-else');
    expect(await otherModel.listByCheckResult(resultIds[0])).toHaveLength(0);
  });
});
