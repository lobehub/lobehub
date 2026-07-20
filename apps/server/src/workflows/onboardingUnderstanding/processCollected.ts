import {
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import type { PublicServeOptions, WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import {
  createUnderstandingService,
  UnderstandingProviderContextUnavailableError,
  type UnderstandingService,
} from '@/server/services/understanding/service';

import {
  type ProcessCollectedUnderstandingPayload,
  ProcessCollectedUnderstandingPayloadSchema,
} from './types';

type CollectedService = Pick<
  UnderstandingService,
  'claimWriting' | 'failWriting' | 'get' | 'writeCollected'
>;

type CollectedWorkflowContext = Pick<
  WorkflowContext<ProcessCollectedUnderstandingPayload>,
  'requestPayload' | 'run'
>;

interface CollectedWorkflowDependencies {
  createService?: (userId: string) => Promise<CollectedService>;
}

const createService = async (userId: string) =>
  createUnderstandingService({ db: await getServerDB(), userId });

const isStaleSession = (error: unknown) =>
  error instanceof UnderstandingResourceNotFoundError ||
  error instanceof UnderstandingSessionNotFoundError ||
  error instanceof StaleUnderstandingRevisionError ||
  error instanceof StaleUnderstandingSessionError;

const isUnclaimableContext = (error: unknown) =>
  error instanceof UnderstandingProviderContextUnavailableError || isStaleSession(error);

export const processCollectedUnderstanding = async (
  context: CollectedWorkflowContext,
  dependencies: CollectedWorkflowDependencies = {},
) => {
  const payload = ProcessCollectedUnderstandingPayloadSchema.parse(context.requestPayload);
  const service = await (dependencies.createService ?? createService)(payload.userId);
  const claim = await context.run('collected:claim', async () => {
    try {
      return await service.claimWriting({
        sessionId: payload.sessionId,
        topicId: payload.topicId,
      });
    } catch (error) {
      if (isUnclaimableContext(error)) return;
      throw error;
    }
  });
  if (!claim) return { published: false as const };
  if (!claim.claimed) {
    return { published: false as const, sourceFingerprint: claim.sourceFingerprint };
  }

  return context.run('collected:write', async () => {
    try {
      return await service.writeCollected({
        sessionId: payload.sessionId,
        sourceFingerprint: claim.sourceFingerprint,
        threadId: claim.threadId,
        topicId: payload.topicId,
      });
    } catch (error) {
      if (isStaleSession(error)) return { published: false as const };
      throw error;
    }
  });
};

export const failRunningUnderstandingWriting = async (
  input: unknown,
  dependencies: CollectedWorkflowDependencies = {},
) => {
  const payload = ProcessCollectedUnderstandingPayloadSchema.parse(input);
  const service = await (dependencies.createService ?? createService)(payload.userId);
  let current: Awaited<ReturnType<CollectedService['get']>>;
  try {
    current = await service.get(payload.topicId);
  } catch (error) {
    if (isStaleSession(error)) return { failed: false as const };
    throw error;
  }
  if (current.id !== payload.sessionId || current.writing?.status !== 'running') {
    return { failed: false as const };
  }

  try {
    const failed = await service.failWriting({
      sessionId: payload.sessionId,
      sourceFingerprint: current.writing.sourceFingerprint,
      topicId: payload.topicId,
    });
    if (!failed) return { failed: false as const };
  } catch (error) {
    if (isStaleSession(error)) return { failed: false as const };
    throw error;
  }
  return {
    failed: true as const,
    sourceFingerprint: current.writing.sourceFingerprint,
  };
};

export const processCollectedWorkflowOptions = {
  failureFunction: async ({
    context: { requestPayload },
  }: {
    context: { requestPayload?: unknown };
  }) => {
    const parsed = ProcessCollectedUnderstandingPayloadSchema.safeParse(requestPayload);
    if (!parsed.success) return 'invalid-payload';
    const result = await failRunningUnderstandingWriting(parsed.data);
    return result.failed ? 'writing-failed' : 'writing-not-current';
  },
  initialPayloadParser: (input: string) =>
    ProcessCollectedUnderstandingPayloadSchema.parse(JSON.parse(input)),
} satisfies PublicServeOptions<ProcessCollectedUnderstandingPayload>;
