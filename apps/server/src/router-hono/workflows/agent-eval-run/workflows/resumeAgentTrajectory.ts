import { type WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type { ResumeAgentTrajectoryPayload } from '@/server/workflows/agentEvalRun';
import { resolveAgentEvalRunWorkspace } from '@/server/workflows/agentEvalRun/utils';
import { runStep } from '@/server/workflows/step';

const log = debug('lobe-server:workflows:resume-agent-trajectory');

export const resumeAgentTrajectoryHandler = async (
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
  const wsId = await resolveAgentEvalRunWorkspace(db, runId);
  const service = new AgentEvalRunService(db, userId, wsId);

  await runStep(context, 'resume-agent-trajectory:exec-agent', () =>
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

export const resumeAgentTrajectoryWorkflowOptions = {
  flowControl: {
    key: 'agent-eval-run.resume-agent-trajectory',
    parallelism: 500,
    ratePerSecond: 20,
  },
};
