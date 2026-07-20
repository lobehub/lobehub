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
  type UnderstandingService,
} from '@/server/services/understanding/service';

import {
  type ProcessCollectedUnderstandingPayload,
  ProcessCollectedUnderstandingPayloadSchema,
} from './types';

type CollectedService = Pick<UnderstandingService, 'failWriting' | 'processCollected'>;

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

export const processCollectedUnderstanding = async (
  context: CollectedWorkflowContext,
  dependencies: CollectedWorkflowDependencies = {},
) => {
  const payload = ProcessCollectedUnderstandingPayloadSchema.parse(context.requestPayload);
  const service = await (dependencies.createService ?? createService)(payload.userId);
  return context.run('collected:process', async () => {
    try {
      return await service.processCollected({
        expectedSourceFingerprint: payload.sourceFingerprint,
        sessionId: payload.sessionId,
        topicId: payload.topicId,
      });
    } catch (error) {
      if (isStaleSession(error)) {
        return { published: false as const, sourceFingerprint: payload.sourceFingerprint };
      }
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
  try {
    const failed = await service.failWriting({
      sessionId: payload.sessionId,
      sourceFingerprint: payload.sourceFingerprint,
      topicId: payload.topicId,
    });
    if (!failed) return { failed: false as const };
  } catch (error) {
    if (isStaleSession(error)) return { failed: false as const };
    throw error;
  }
  return {
    failed: true as const,
    sourceFingerprint: payload.sourceFingerprint,
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
