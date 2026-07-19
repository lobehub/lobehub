import {
  StaleUnderstandingSessionError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';

import { getServerDB } from '@/database/server';
import {
  createUnderstandingService,
  terminalizeUnderstandingWorkflow,
  UnderstandingBranchFailureError,
  type UnderstandingService,
  type UnderstandingSourceLaunchReference,
} from '@/server/services/understanding/service';

import {
  getOnboardingUnderstandingFlowControlKey,
  type OnboardingUnderstandingWorkflowPayload,
  OnboardingUnderstandingWorkflowPayloadSchema,
} from './types';

interface SourceBranch {
  sourceId: string;
  threadId: string;
}

type SourceStatus = 'completed' | 'failed';

export interface OnboardingUnderstandingWorkflowContext {
  requestPayload?: unknown;
  run: <TResult>(stepName: string, handler: () => Promise<TResult>) => Promise<TResult>;
  workflowRunId: string;
}

interface RunOnboardingUnderstandingWorkflowDependencies {
  createService?: (userId: string) => Promise<UnderstandingService>;
}

const sourceIdentity = (payload: OnboardingUnderstandingWorkflowPayload, branch: SourceBranch) => ({
  sessionId: payload.sessionId,
  sourceId: branch.sourceId,
  threadId: branch.threadId,
  topicId: payload.topicId,
});

// Durable step output deliberately excludes analyses and connector-derived evidence.
const toSafeStepResult = (result: { kind: string; resultId: string }) => ({
  kind: result.kind,
  resultId: result.resultId,
});

const persistSourceFailure = async (
  service: UnderstandingService,
  payload: OnboardingUnderstandingWorkflowPayload,
  branch: SourceBranch,
): Promise<SourceStatus> => {
  const result = toSafeStepResult(await service.failSource(sourceIdentity(payload, branch)));
  return result.kind === 'source' ? 'completed' : 'failed';
};

const executeSource = async (
  service: UnderstandingService,
  payload: OnboardingUnderstandingWorkflowPayload,
  branch: SourceBranch,
  launch: UnderstandingSourceLaunchReference,
): Promise<SourceStatus> => {
  const execution = await service.executeAgentOperation(launch.operationId);
  if (execution.status === 'error') return persistSourceFailure(service, payload, branch);
  if (execution.status !== 'done') {
    throw new Error('Understanding source operation did not settle');
  }

  const result = toSafeStepResult(
    await service.finalizeSource({
      ...sourceIdentity(payload, branch),
      assistantMessageId: launch.assistantMessageId,
    }),
  );
  return result.kind === 'source' ? 'completed' : 'failed';
};

const runMerge = async (
  context: OnboardingUnderstandingWorkflowContext,
  service: UnderstandingService,
  payload: OnboardingUnderstandingWorkflowPayload,
) => {
  const requestedThreadId = `merge-${context.workflowRunId}`;
  const launch = await context.run('merge:launch', () =>
    service.launchMerge(
      payload.topicId,
      payload.sessionId,
      context.workflowRunId,
      requestedThreadId,
    ),
  );
  if ('failed' in launch) {
    await context.run('merge:fail', async () =>
      toSafeStepResult(
        await service.failMerge({
          sessionId: payload.sessionId,
          threadId: launch.threadId,
          topicId: payload.topicId,
        }),
      ),
    );
    return 'failed' as const;
  }
  if (launch.skipped) return 'skipped' as const;
  const mergeIdentity = {
    assistantMessageId: launch.assistantMessageId,
    sessionId: payload.sessionId,
    threadId: launch.threadId,
    topicId: payload.topicId,
  };

  const execution = await context.run('merge:execute', () =>
    service.executeAgentOperation(launch.operationId),
  );
  if (execution.status === 'error') {
    await context.run('merge:fail', async () =>
      toSafeStepResult(await service.failMerge(mergeIdentity)),
    );
    return 'failed' as const;
  }
  if (execution.status !== 'done') {
    throw new Error('Understanding merge operation did not settle');
  }

  const result = await context.run('merge:finalize', async () =>
    toSafeStepResult(
      await service.finalizeMerge({
        assistantMessageId: launch.assistantMessageId,
        sessionId: payload.sessionId,
        threadId: launch.threadId,
        topicId: payload.topicId,
      }),
    ),
  );
  return result.kind === 'merged' ? ('completed' as const) : ('failed' as const);
};

export const runOnboardingUnderstandingWorkflow = async (
  context: OnboardingUnderstandingWorkflowContext,
  dependencies: RunOnboardingUnderstandingWorkflowDependencies = {},
) => {
  const payload = OnboardingUnderstandingWorkflowPayloadSchema.parse(context.requestPayload);
  const service = dependencies.createService
    ? await dependencies.createService(payload.userId)
    : await createUnderstandingService({ db: await getServerDB(), userId: payload.userId });

  await context.run('attach-workflow-run', async () => {
    await service.attachWorkflowRun(payload.topicId, payload.sessionId, context.workflowRunId);
    return { attached: true };
  });

  let branches: SourceBranch[];
  if (payload.mode === 'initial') {
    await context.run('discover', async () => ({
      sourceCount: (await service.discover(payload.topicId, payload.sessionId)).length,
    }));
    branches = await service.getSourceBranches(payload.topicId, payload.sessionId);
  } else {
    const prepared = await context.run('retry:prepare', async () => {
      const branch = await service.prepareRetry({
        sessionId: payload.sessionId,
        sourceId: payload.sourceId!,
        topicId: payload.topicId,
      });
      return { threadId: branch.threadId };
    });
    branches = [{ sourceId: payload.sourceId!, threadId: prepared.threadId }];
  }
  branches.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const collected = await context.run('sources:collect', () =>
    Promise.all(
      branches.map(async (branch) => {
        try {
          await service.collectSource(sourceIdentity(payload, branch));
          return true;
        } catch (error) {
          if (!(error instanceof UnderstandingBranchFailureError)) throw error;
          return false;
        }
      }),
    ),
  );

  const launches: Array<{
    launch?: Omit<UnderstandingSourceLaunchReference, 'sourceId'>;
  }> = [];
  for (const [index, wasCollected] of collected.entries()) {
    const branch = branches[index];
    launches.push(
      await context.run(`sources:launch:${index}`, async () => {
        if (!wasCollected) return {};
        try {
          const launch = await service.launchSourceAnalysis(sourceIdentity(payload, branch));
          if ('skipped' in launch) return {};
          return {
            launch: {
              assistantMessageId: launch.assistantMessageId,
              operationId: launch.operationId,
              success: launch.success,
              threadId: launch.threadId,
            },
          };
        } catch (error) {
          if (!(error instanceof UnderstandingBranchFailureError)) throw error;
          return {};
        }
      }),
    );
  }

  const outcomes = await context.run('sources:execute-finalize', () =>
    Promise.all(
      launches.map(async ({ launch }, index) => ({
        index,
        status: launch
          ? await executeSource(service, payload, branches[index], launch)
          : await persistSourceFailure(service, payload, branches[index]),
      })),
    ),
  );

  const merge = outcomes.some(({ status }) => status === 'completed')
    ? await runMerge(context, service, payload)
    : ('skipped' as const);

  return { merge, sources: outcomes };
};

export const createOnboardingUnderstandingWorkflowOptions = (sessionId: string) => ({
  failureFunction: async ({
    context,
  }: {
    context: { requestPayload?: unknown; workflowRunId: string };
  }) => {
    const parsed = OnboardingUnderstandingWorkflowPayloadSchema.safeParse(context.requestPayload);
    if (!parsed.success || parsed.data.sessionId !== sessionId) return 'invalid-payload';

    try {
      await terminalizeUnderstandingWorkflow({
        db: await getServerDB(),
        sessionId: parsed.data.sessionId,
        topicId: parsed.data.topicId,
        userId: parsed.data.userId,
        workflowRunId: context.workflowRunId,
      });
    } catch (error) {
      if (
        error instanceof UnderstandingSessionNotFoundError ||
        error instanceof StaleUnderstandingSessionError
      ) {
        return 'session-not-current';
      }
      throw error;
    }
    return 'session-terminalized';
  },
  flowControl: {
    key: getOnboardingUnderstandingFlowControlKey(sessionId),
    parallelism: 1,
  },
});
