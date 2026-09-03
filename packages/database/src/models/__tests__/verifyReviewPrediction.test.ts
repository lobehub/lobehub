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

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await new AgentOperationModel(serverDB, userId).recordStart({ operationId });
  const run = await new VerifyRunModel(serverDB, userId).ensureForOperation(operationId);
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
