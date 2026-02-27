import { serve } from '@upstash/workflow/nextjs';
import debug from 'debug';
import { chunk } from 'es-toolkit/compat';

import { AgentEvalRunModel, AgentEvalTestCaseModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import {
  AgentEvalRunWorkflow,
  type PaginateTestCasesPayload,
} from '@/server/workflows/agentEvalRun';

const CHUNK_SIZE = 20; // Max items to process directly
const PAGE_SIZE = 50; // Items per page

const log = debug('lobe-server:workflows:paginate-test-cases');

/**
 * Paginate test cases workflow - handles pagination, filtering, and fanout
 */
export const { POST } = serve<PaginateTestCasesPayload>(
  async (context) => {
    const { runId, cursor, testCaseIds: payloadTestCaseIds, userId } = context.requestPayload ?? {};

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

    // If specific testCaseIds are provided (from fanout), process them directly
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

    // Check if run was aborted before paginating
    const runStatus = await context.run('agent-eval-run:check-abort', async () => {
      const runModel = new AgentEvalRunModel(db, userId);
      const run = await runModel.findById(runId);
      return run?.status;
    });

    if (runStatus === 'aborted') {
      log('Run aborted, skipping: runId=%s', runId);
      return { cancelled: true };
    }

    // Paginate through test cases
    const testCaseBatch = await context.run('agent-eval-run:get-test-cases-page', async () => {
      // Get run to find datasetId and userId
      const runModel = new AgentEvalRunModel(db, userId);
      const run = await runModel.findById(runId);
      if (!run) return { ids: [] };

      // Get test cases for this dataset
      const testCaseModel = new AgentEvalTestCaseModel(db, userId);
      const allTestCases = await testCaseModel.findByDatasetId(run.datasetId);

      // Apply cursor-based pagination
      const startIndex = cursor
        ? allTestCases.findIndex((tc: { id: string }) => tc.id === cursor) + 1
        : 0;

      const page = allTestCases.slice(startIndex, startIndex + PAGE_SIZE);

      if (!page.length) return { ids: [] };

      const last = page.at(-1);
      return {
        cursor: last?.id,
        ids: page.map((tc: { id: string }) => tc.id),
      };
    });

    const batchTestCaseIds = testCaseBatch.ids;
    const nextCursor = 'cursor' in testCaseBatch ? testCaseBatch.cursor : undefined;

    log('Got batch: size=%d nextCursor=%s', batchTestCaseIds.length, nextCursor ?? 'none');

    if (batchTestCaseIds.length === 0) {
      log('No more test cases, pagination complete');
      return { message: 'Pagination complete', success: true };
    }

    // Filter test cases that need execution
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

    // Process test cases if any need execution
    if (testCaseIds.length > 0) {
      if (testCaseIds.length > CHUNK_SIZE) {
        // Fanout to smaller chunks
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
        // Process directly
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

    // Schedule next page
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
  },
  {
    flowControl: { key: 'agent-eval-run.paginate-test-cases', parallelism: 200, rate: 5 },
    qstashClient,
  },
);
