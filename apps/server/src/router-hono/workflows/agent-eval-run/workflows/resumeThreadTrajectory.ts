import { type WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type { ResumeThreadTrajectoryPayload } from '@/server/workflows/agentEvalRun';
import { resolveAgentEvalRunWorkspace } from '@/server/workflows/agentEvalRun/utils';
import { runStep } from '@/server/workflows/step';

const log = debug('lobe-server:workflows:resume-thread-trajectory');

export const resumeThreadTrajectoryHandler = async (
  context: WorkflowContext<ResumeThreadTrajectoryPayload>,
) => {
  const payload = context.requestPayload ?? {};
  const { runId, testCaseId, threadId, topicId, userId } = payload;

  log('Starting: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);

  if (
    !runId ||
    !testCaseId ||
    !threadId ||
    !topicId ||
    !userId ||
    !payload.parentMessageId ||
    !payload.appContext?.topicId ||
    !payload.appContext?.threadId
  ) {
    return { error: 'Missing required parameters', success: false };
  }

  const db = await getServerDB();
  const wsId = await resolveAgentEvalRunWorkspace(db, runId);
  const service = new AgentEvalRunService(db, userId, wsId);

  await runStep(context, 'resume-thread-trajectory:exec-agent', () =>
    service.executeResumedThreadTrajectory(payload),
  );

  log(
    'Resumed thread agent started: runId=%s testCaseId=%s threadId=%s',
    runId,
    testCaseId,
    threadId,
  );

  return { success: true, testCaseId, threadId, topicId };
};

export const resumeThreadTrajectoryWorkflowOptions = {
  flowControl: {
    key: 'agent-eval-run.resume-thread-trajectory',
    parallelism: 500,
    ratePerSecond: 20,
  },
};
