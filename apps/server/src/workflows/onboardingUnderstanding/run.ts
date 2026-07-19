import { getServerDB } from '@/database/server';
import {
  createUnderstandingService,
  type UnderstandingService,
  type UnderstandingSourceLaunchReference,
} from '@/server/services/understanding/service';

import {
  type OnboardingUnderstandingWorkflowPayload,
  OnboardingUnderstandingWorkflowPayloadSchema,
} from './types';

interface SourceBranch {
  sourceId: string;
  threadId: string;
}

interface WorkflowSourceBranch extends SourceBranch {
  stepName: string;
}

interface SourceOutcome {
  sourceId: string;
  status: 'completed' | 'failed';
}

export interface OnboardingUnderstandingWorkflowContext {
  requestPayload?: unknown;
  run: <TResult>(stepName: string, handler: () => Promise<TResult>) => Promise<TResult>;
  workflowRunId: string;
}

interface RunOnboardingUnderstandingWorkflowDependencies {
  createService?: (userId: string) => Promise<UnderstandingService>;
}

const addStepNames = (branches: SourceBranch[]): WorkflowSourceBranch[] => {
  const providerCounts = new Map<string, number>();
  return branches.map((branch) => {
    const provider = branch.sourceId.split(':', 1)[0];
    const count = (providerCounts.get(provider) ?? 0) + 1;
    providerCounts.set(provider, count);
    return { ...branch, stepName: count === 1 ? provider : `${provider}-${count}` };
  });
};

const sourceIdentity = (
  payload: OnboardingUnderstandingWorkflowPayload,
  branch: WorkflowSourceBranch,
) => ({
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

const failSource = async (
  context: OnboardingUnderstandingWorkflowContext,
  service: UnderstandingService,
  payload: OnboardingUnderstandingWorkflowPayload,
  branch: WorkflowSourceBranch,
): Promise<SourceOutcome> => {
  const result = await context.run(`${branch.stepName}:fail`, async () =>
    toSafeStepResult(await service.failSource(sourceIdentity(payload, branch))),
  );
  return { sourceId: branch.sourceId, status: result.kind === 'source' ? 'completed' : 'failed' };
};

const executeSource = async (
  context: OnboardingUnderstandingWorkflowContext,
  service: UnderstandingService,
  payload: OnboardingUnderstandingWorkflowPayload,
  branch: WorkflowSourceBranch,
  launch: UnderstandingSourceLaunchReference,
): Promise<SourceOutcome> => {
  try {
    const execution = await context.run(`${branch.stepName}:execute`, () =>
      service.executeAgentOperation(launch.operationId),
    );
    if (execution.status !== 'done') throw new Error('Understanding source operation failed');

    const result = await context.run(`${branch.stepName}:finalize`, async () =>
      toSafeStepResult(
        await service.finalizeSource({
          ...sourceIdentity(payload, branch),
          assistantMessageId: launch.assistantMessageId,
        }),
      ),
    );
    return {
      sourceId: branch.sourceId,
      status: result.kind === 'source' ? 'completed' : 'failed',
    };
  } catch {
    // The durable step exhausted its retries; persist one terminal source result below.
  }
  return failSource(context, service, payload, branch);
};

const runMerge = async (
  context: OnboardingUnderstandingWorkflowContext,
  service: UnderstandingService,
  payload: OnboardingUnderstandingWorkflowPayload,
) => {
  const requestedThreadId = `merge-${context.workflowRunId}`;
  let mergeIdentity: {
    assistantMessageId?: string;
    sessionId: string;
    threadId: string;
    topicId: string;
  } = {
    sessionId: payload.sessionId,
    threadId: requestedThreadId,
    topicId: payload.topicId,
  };
  try {
    const launch = await context.run('merge:launch', () =>
      service.launchMerge(payload.topicId, payload.sessionId, requestedThreadId),
    );
    if (launch.skipped) return 'skipped' as const;
    mergeIdentity = {
      assistantMessageId: launch.assistantMessageId,
      sessionId: payload.sessionId,
      threadId: launch.threadId,
      topicId: payload.topicId,
    };

    const execution = await context.run('merge:execute', () =>
      service.executeAgentOperation(launch.operationId),
    );
    if (execution.status !== 'done') throw new Error('Understanding merge operation failed');

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
  } catch {
    await context.run('merge:fail', async () =>
      toSafeStepResult(await service.failMerge(mergeIdentity)),
    );
    return 'failed' as const;
  }
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

  const branches = addStepNames(
    (payload.mode === 'initial'
      ? await context.run('discover', () => service.discover(payload.topicId, payload.sessionId))
      : [
          await context.run('retry:prepare', () =>
            service.prepareRetry({
              sessionId: payload.sessionId,
              sourceId: payload.sourceId!,
              topicId: payload.topicId,
            }),
          ),
        ]
    ).sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  );

  const collected = await Promise.all(
    branches.map(async (branch) => {
      try {
        await context.run(`${branch.stepName}:collect`, () =>
          service.collectSource(sourceIdentity(payload, branch)),
        );
        return { branch, collected: true as const };
      } catch {
        return { branch, collected: false as const };
      }
    }),
  );

  const outcomes: SourceOutcome[] = [];
  const launches: Array<{
    branch: WorkflowSourceBranch;
    launch: UnderstandingSourceLaunchReference;
  }> = [];
  for (const item of collected) {
    if (!item.collected) {
      outcomes.push(await failSource(context, service, payload, item.branch));
      continue;
    }
    try {
      const launch = await context.run(`${item.branch.stepName}:launch`, () =>
        service.launchSourceAnalysis(sourceIdentity(payload, item.branch)),
      );
      if ('skipped' in launch) {
        outcomes.push(await failSource(context, service, payload, item.branch));
      } else {
        launches.push({ branch: item.branch, launch });
      }
    } catch {
      outcomes.push(await failSource(context, service, payload, item.branch));
    }
  }

  outcomes.push(
    ...(await Promise.all(
      launches.map(({ branch, launch }) =>
        executeSource(context, service, payload, branch, launch),
      ),
    )),
  );
  outcomes.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const merge = outcomes.some(({ status }) => status === 'completed')
    ? await runMerge(context, service, payload)
    : ('skipped' as const);

  return { merge, sources: outcomes };
};
