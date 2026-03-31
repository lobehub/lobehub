import debug from 'debug';
import { NextResponse } from 'next/server';

import { AgentEvalRunModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import {
  AgentEvalRunWorkflow,
  type OnTrajectoryCompletePayload,
} from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:on-trajectory-complete');

/**
 * On-trajectory-complete webhook handler
 *
 * Receives a POST from the AgentRuntimeService completion webhook after an
 * agent operation finishes (success or error). Checks whether all test cases
 * for the run are done and, if so, triggers the finalize-run workflow.
 *
 * This is a plain Next.js route handler (NOT an Upstash workflow / serve()).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as OnTrajectoryCompletePayload;
    const {
      runId,
      testCaseId,
      userId,
      operationId,
      reason,
      status,
      cost,
      duration,
      errorDetail,
      errorMessage,
      llmCalls,
      steps,
      toolCalls,
      totalTokens,
    } = body;

    if (!runId || !testCaseId || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    log(
      'Received: runId=%s testCaseId=%s operationId=%s reason=%s status=%s cost=%s duration=%s steps=%s totalTokens=%s',
      runId,
      testCaseId,
      operationId,
      reason,
      status,
      cost,
      duration,
      steps,
      totalTokens,
    );

    const db = await getServerDB();

    // Check if run was aborted — skip processing to avoid overwriting abort state
    const runModel = new AgentEvalRunModel(db, userId);
    const run = await runModel.findById(runId);
    if (run?.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
      return NextResponse.json({ cancelled: true });
    }

    const service = new AgentEvalRunService(db, userId);

    const { allDone, completedCount } = await service.recordTrajectoryCompletion({
      runId,
      status,
      telemetry: {
        completionReason: reason,
        cost,
        duration,
        errorDetail,
        errorMessage,
        llmCalls,
        steps,
        toolCalls,
        totalTokens,
      },
      testCaseId,
    });

    log('Completion check: %d completed, allDone=%s', completedCount, allDone);

    if (allDone) {
      console.info(
        '[on-trajectory-complete] All test cases done for run %s, triggering finalize',
        runId,
      );
      await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[on-trajectory-complete] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}
