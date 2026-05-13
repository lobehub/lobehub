import debug from 'debug';

import type {
  OnThreadCompletePayload,
  OnTrajectoryCompletePayload,
} from '@/server/workflows/agentEvalRun';

const threadLog = debug('lobe-server:workflows:on-thread-complete');
const trajectoryLog = debug('lobe-server:workflows:on-trajectory-complete');

export const agentEvalRunOnThreadCompleteAPIHandler = async (request: Request) => {
  try {
    const body = (await request.json()) as OnThreadCompletePayload;
    const {
      runId,
      testCaseId,
      threadId,
      topicId,
      userId,
      operationId: _operationId,
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
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    threadLog(
      'Received: runId=%s testCaseId=%s threadId=%s status=%s cost=%s duration=%s',
      runId,
      testCaseId,
      threadId,
      status,
      cost,
      duration,
    );

    const [{ AgentEvalRunModel }, { getServerDB }, { AgentEvalRunService }] = await Promise.all([
      import('@/database/models/agentEval'),
      import('@/database/server'),
      import('@/server/services/agentEvalRun'),
    ]);
    const db = await getServerDB();

    const runModel = new AgentEvalRunModel(db, userId);
    const run = await runModel.findById(runId);
    if (run?.status === 'aborted') {
      threadLog(
        'Run aborted, skipping: runId=%s testCaseId=%s threadId=%s',
        runId,
        testCaseId,
        threadId,
      );
      return Response.json({ cancelled: true });
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

    threadLog(
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
      const { AgentEvalRunWorkflow } = await import('@/server/workflows/agentEvalRun');
      await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
    }

    return Response.json({ allRunDone, allThreadsDone, success: true });
  } catch (error) {
    console.error('[on-thread-complete] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
};

export const agentEvalRunOnTrajectoryCompleteAPIHandler = async (request: Request) => {
  try {
    const body = (await request.json()) as OnTrajectoryCompletePayload;
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
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    trajectoryLog(
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

    const [{ AgentEvalRunModel }, { getServerDB }, { AgentEvalRunService }] = await Promise.all([
      import('@/database/models/agentEval'),
      import('@/database/server'),
      import('@/server/services/agentEvalRun'),
    ]);
    const db = await getServerDB();

    const runModel = new AgentEvalRunModel(db, userId);
    const run = await runModel.findById(runId);
    if (run?.status === 'aborted') {
      trajectoryLog('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
      return Response.json({ cancelled: true });
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

    trajectoryLog('Completion check: %d completed, allDone=%s', completedCount, allDone);

    if (allDone) {
      console.info(
        '[on-trajectory-complete] All test cases done for run %s, triggering finalize',
        runId,
      );
      const { AgentEvalRunWorkflow } = await import('@/server/workflows/agentEvalRun');
      await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('[on-trajectory-complete] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
};
