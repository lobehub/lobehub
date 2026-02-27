import debug from 'debug';
import { NextResponse } from 'next/server';

import { AgentEvalRunModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import {
  AgentEvalRunWorkflow,
  type OnThreadCompletePayload,
} from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:on-thread-complete');

/**
 * On-thread-complete webhook handler (for pass@k).
 *
 * Receives a POST from the AgentRuntimeService completion webhook after a
 * thread-level agent operation finishes. Evaluates the thread independently,
 * writes result to thread.metadata, then checks if all K threads for the
 * topic are done. If so, aggregates into RunTopic and checks run completion.
 *
 * This is a plain Next.js route handler (NOT an Upstash workflow / serve()).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as OnThreadCompletePayload;
    const {
      runId,
      testCaseId,
      threadId,
      topicId,
      userId,
      operationId,
      reason,
      status,
      cost,
      duration,
      errorMessage,
      llmCalls,
      steps,
      toolCalls,
      totalTokens,
    } = body;

    if (!runId || !testCaseId || !threadId || !topicId || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    log(
      'Received: runId=%s testCaseId=%s threadId=%s status=%s cost=%s duration=%s',
      runId,
      testCaseId,
      threadId,
      status,
      cost,
      duration,
    );

    const db = await getServerDB();

    // Check if run was aborted — skip processing to avoid overwriting abort state
    const runModel = new AgentEvalRunModel(db, userId);
    const run = await runModel.findById(runId);
    if (run?.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);
      return NextResponse.json({ cancelled: true });
    }

    const service = new AgentEvalRunService(db, userId);

    const { allThreadsDone, allRunDone } = await service.recordThreadCompletion({
      runId,
      status,
      telemetry: {
        completionReason: reason,
        cost,
        duration,
        errorMessage,
        llmCalls,
        steps,
        toolCalls,
        totalTokens,
      },
      testCaseId,
      threadId,
      topicId,
    });

    log(
      'Thread completion: threadId=%s allThreadsDone=%s allRunDone=%s',
      threadId,
      allThreadsDone,
      allRunDone,
    );

    if (allRunDone) {
      console.info(
        '[on-thread-complete] All test cases done for run %s, triggering finalize',
        runId,
      );
      await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
    }

    return NextResponse.json({ allRunDone, allThreadsDone, success: true });
  } catch (error) {
    console.error('[on-thread-complete] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}
