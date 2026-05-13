import type { WorkflowContext } from '@upstash/workflow';
import debug from 'debug';
import { chunk } from 'es-toolkit/compat';

import { AgentEvalRunModel, AgentEvalTestCaseModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import {
  AgentEvalRunWorkflow,
  type PaginateTestCasesPayload,
} from '@/server/workflows/agentEvalRun';

const CHUNK_SIZE = 20;
const PAGE_SIZE = 50;

const log = debug('lobe-server:workflows:paginate-test-cases');

export const paginateTestCasesWorkflowConfig = {
  flowControl: { key: 'agent-eval-run.paginate-test-cases', parallelism: 200, rate: 5 },
};

export const paginateTestCasesWorkflowHandler = async (
  context: WorkflowContext<PaginateTestCasesPayload>,
) => {
  const { cursor, runId, testCaseIds: payloadTestCaseIds, userId } = context.requestPayload ?? {};

  log(
    'Starting: runId=%s cursor=%s testCaseIds=%d',
    runId,
    cursor,
    payloadTestCaseIds?.length ?? 0,
  );

  if (!runId || !userId) {
    return { error: 'Missing runId or userId in payload', success: false };
  }

  const db = await getServerDB();

  if (payloadTestCaseIds && payloadTestCaseIds.length > 0) {
    log('Processing fanout chunk: %d items', payloadTestCaseIds.length);

    await Promise.all(
      payloadTestCaseIds.map((testCaseId) =>
        context.run(`agent-eval-run:execute:${testCaseId}`, () =>
          AgentEvalRunWorkflow.triggerExecuteTestCase({ runId, testCaseId, userId }),
        ),
      ),
    );

    return {
      processedTestCases: payloadTestCaseIds.length,
      success: true,
    };
  }

  const runStatus = await context.run('agent-eval-run:check-abort', async () => {
    const runModel = new AgentEvalRunModel(db, userId);
    const run = await runModel.findById(runId);
    return run?.status;
  });

  if (runStatus === 'aborted') {
    log('Run aborted, skipping: runId=%s', runId);
    return { cancelled: true };
  }

  const testCaseBatch = await context.run('agent-eval-run:get-test-cases-page', async () => {
    const runModel = new AgentEvalRunModel(db, userId);
    const run = await runModel.findById(runId);
    if (!run) return { ids: [] };

    const testCaseModel = new AgentEvalTestCaseModel(db, userId);
    const allTestCases = await testCaseModel.findByDatasetId(run.datasetId);

    const startIndex = cursor
      ? allTestCases.findIndex((testCase: { id: string }) => testCase.id === cursor) + 1
      : 0;

    const page = allTestCases.slice(startIndex, startIndex + PAGE_SIZE);

    if (!page.length) return { ids: [] };

    const last = page.at(-1);
    return {
      cursor: last?.id,
      ids: page.map((testCase: { id: string }) => testCase.id),
    };
  });

  const batchTestCaseIds = testCaseBatch.ids;
  const nextCursor = 'cursor' in testCaseBatch ? testCaseBatch.cursor : undefined;

  log('Got batch: size=%d nextCursor=%s', batchTestCaseIds.length, nextCursor ?? 'none');

  if (batchTestCaseIds.length === 0) {
    log('No more test cases, pagination complete');
    return { message: 'Pagination complete', success: true };
  }

  const testCaseIds = await context.run('agent-eval-run:filter-existing', () =>
    AgentEvalRunWorkflow.filterTestCasesNeedingExecution(db, {
      runId,
      testCaseIds: batchTestCaseIds,
      userId,
    }),
  );

  log(
    'After filtering: need=%d skipped=%d',
    testCaseIds.length,
    batchTestCaseIds.length - testCaseIds.length,
  );

  if (testCaseIds.length > 0) {
    if (testCaseIds.length > CHUNK_SIZE) {
      const chunks = chunk(testCaseIds, CHUNK_SIZE);
      log('Fanout: %d chunks of %d', chunks.length, CHUNK_SIZE);

      await Promise.all(
        chunks.map((ids, idx) =>
          context.run(`agent-eval-run:fanout:${idx + 1}/${chunks.length}`, () =>
            AgentEvalRunWorkflow.triggerPaginateTestCases({ runId, testCaseIds: ids, userId }),
          ),
        ),
      );
    } else {
      log('Processing %d test cases directly', testCaseIds.length);

      await Promise.all(
        testCaseIds.map((testCaseId) =>
          context.run(`agent-eval-run:execute:${testCaseId}`, () =>
            AgentEvalRunWorkflow.triggerExecuteTestCase({ runId, testCaseId, userId }),
          ),
        ),
      );
    }
  }

  if (nextCursor) {
    log('Scheduling next page with cursor %s', nextCursor);
    await context.run('agent-eval-run:next-page', () =>
      AgentEvalRunWorkflow.triggerPaginateTestCases({ cursor: nextCursor, runId, userId }),
    );
  } else {
    log('Last page, pagination complete');
  }

  return {
    nextCursor: nextCursor ?? null,
    processedTestCases: testCaseIds.length,
    skippedTestCases: batchTestCaseIds.length - testCaseIds.length,
    success: true,
  };
};
