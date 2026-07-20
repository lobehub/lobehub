import { createHash } from 'node:crypto';

import {
  StaleUnderstandingSessionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import type { InvokableWorkflow, PublicServeOptions, WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import {
  createUnderstandingService,
  type UnderstandingService,
} from '@/server/services/understanding/service';

import {
  getUnderstandingWritingFlowControlKey,
  type ProcessCollectedUnderstandingPayload,
  type ProcessUnderstandingProvidersPayload,
  ProcessUnderstandingProvidersPayloadSchema,
} from './types';

type ProviderService = Pick<UnderstandingService, 'failProvider' | 'get' | 'processProvider'>;

type ProviderWorkflowContext = Pick<
  WorkflowContext<ProcessUnderstandingProvidersPayload>,
  'invoke' | 'requestPayload' | 'run'
>;

interface ProviderWorkflowDependencies {
  createService?: (userId: string) => Promise<ProviderService>;
  processCollectedWorkflow: InvokableWorkflow<ProcessCollectedUnderstandingPayload, unknown>;
}

interface ProviderFailureDependencies {
  createService?: (userId: string) => Promise<ProviderService>;
}

const createService = async (userId: string) =>
  createUnderstandingService({ db: await getServerDB(), userId });

const isTerminalizedSession = (error: unknown) =>
  error instanceof StaleUnderstandingSessionError ||
  error instanceof UnderstandingResourceNotFoundError ||
  error instanceof UnderstandingSessionNotFoundError;

const collectedWorkflowRunId = (sessionId: string, sourceFingerprint: string) =>
  `onboarding-understanding-collected-${createHash('sha256')
    .update(sessionId)
    .update('\0')
    .update(sourceFingerprint)
    .digest('hex')
    .slice(0, 32)}`;

export const processUnderstandingProviders = async (
  context: ProviderWorkflowContext,
  dependencies: ProviderWorkflowDependencies,
) => {
  const parsed = ProcessUnderstandingProvidersPayloadSchema.parse(context.requestPayload);
  const payload = {
    ...parsed,
    providerIds: [...new Set(parsed.providerIds)].sort(),
  };
  const service = await (dependencies.createService ?? createService)(payload.userId);

  const providers = await Promise.all(
    payload.providerIds.map(async (providerId) => {
      const result = await context.run(`provider:${providerId}:process`, () =>
        service.processProvider({
          providerId,
          sessionId: payload.sessionId,
          topicId: payload.topicId,
        }),
      );
      if (result.status === 'completed') {
        await context.invoke(`provider:${providerId}:write:${result.revision}`, {
          body: {
            sessionId: payload.sessionId,
            sourceFingerprint: result.sourceFingerprint,
            topicId: payload.topicId,
            userId: payload.userId,
          },
          // Serialize writers for this session. The repository's fingerprint CAS then prevents a
          // delayed failure callback for an older invocation from terminalizing newer writing.
          flowControl: {
            key: getUnderstandingWritingFlowControlKey(payload.sessionId),
            parallelism: 1,
          },
          workflow: dependencies.processCollectedWorkflow,
          workflowRunId: collectedWorkflowRunId(payload.sessionId, result.sourceFingerprint),
        });
      }

      return {
        failedCount: result.failedCount,
        providerId,
        revision: result.revision,
        sourceCount: result.sourceCount,
        status: result.status,
        succeededCount: result.succeededCount,
      };
    }),
  );

  return { providers };
};

export const failRunningUnderstandingProviders = async (
  input: unknown,
  dependencies: ProviderFailureDependencies = {},
) => {
  const payload = ProcessUnderstandingProvidersPayloadSchema.parse(input);
  const providerIds = [...new Set(payload.providerIds)].sort();
  const service = await (dependencies.createService ?? createService)(payload.userId);
  const failedProviderIds: string[] = [];
  let current: Awaited<ReturnType<ProviderService['get']>>;
  try {
    current = await service.get(payload.topicId);
  } catch (error) {
    if (isTerminalizedSession(error)) return { failedProviderIds };
    throw error;
  }
  if (current.id !== payload.sessionId) return { failedProviderIds };

  await Promise.all(
    providerIds.map(async (providerId) => {
      const source = current.sources[providerId];
      if (source?.status !== 'running') return;
      try {
        const failed = await service.failProvider({
          providerId,
          revision: source.revision,
          sessionId: payload.sessionId,
          topicId: payload.topicId,
        });
        if (failed) failedProviderIds.push(providerId);
      } catch (error) {
        if (!isTerminalizedSession(error)) throw error;
      }
    }),
  );

  return { failedProviderIds: failedProviderIds.sort() };
};

export const processProvidersWorkflowOptions = {
  failureFunction: async ({
    context: { requestPayload },
  }: {
    context: { requestPayload?: unknown };
  }) => {
    const parsed = ProcessUnderstandingProvidersPayloadSchema.safeParse(requestPayload);
    if (!parsed.success) return 'invalid-payload';
    const result = await failRunningUnderstandingProviders(parsed.data);
    return `failed-providers:${result.failedProviderIds.length}`;
  },
  initialPayloadParser: (input: string) =>
    ProcessUnderstandingProvidersPayloadSchema.parse(JSON.parse(input)),
} satisfies PublicServeOptions<ProcessUnderstandingProvidersPayload>;
