import type { WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type { ResumeAgentTrajectoryPayload } from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:resume-agent-trajectory');

export const resumeAgentTrajectoryWorkflowConfig = {
  flowControl: {
    key: 'agent-eval-run.resume-agent-trajectory',
    parallelism: 500,
    ratePerSecond: 20,
  },
};

export const resumeAgentTrajectoryWorkflowHandler = async (
  context: WorkflowContext<ResumeAgentTrajectoryPayload>,
) => {
  const payload = context.requestPayload ?? {};
  const { runId, testCaseId, topicId, userId } = payload;

  log('Starting: runId=%s testCaseId=%s', runId, testCaseId);

  if (
    !runId ||
    !testCaseId ||
    !topicId ||
    !userId ||
    !payload.parentMessageId ||
    !payload.appContext?.topicId
  ) {
    return { error: 'Missing required parameters', success: false };
  }

  const db = await getServerDB();
  const service = new AgentEvalRunService(db, userId);

  await context.run('resume-agent-trajectory:exec-agent', () =>
    service.executeResumedTrajectory(payload),
  );

  log(
    'Resumed agent started (async): runId=%s testCaseId=%s topicId=%s',
    runId,
    testCaseId,
    topicId,
  );

  return { success: true, testCaseId, topicId };
};
