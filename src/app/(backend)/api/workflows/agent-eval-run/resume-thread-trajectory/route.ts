import { serve } from '@upstash/workflow/nextjs';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type { ResumeThreadTrajectoryPayload } from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:resume-thread-trajectory');

export const { POST } = serve<ResumeThreadTrajectoryPayload>(
  async (context) => {
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
    const service = new AgentEvalRunService(db, userId);

    await context.run('resume-thread-trajectory:exec-agent', () =>
      service.executeResumedThreadTrajectory(payload),
    );

    log(
      'Resumed thread agent started: runId=%s testCaseId=%s threadId=%s',
      runId,
      testCaseId,
      threadId,
    );

    return { success: true, testCaseId, threadId, topicId };
  },
  {
    flowControl: {
      key: 'agent-eval-run.resume-thread-trajectory',
      parallelism: 500,
      ratePerSecond: 20,
    },
    qstashClient,
  },
);
