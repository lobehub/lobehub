import { createHash } from 'node:crypto';

import {
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import { observeOnboardingUnderstandingOperation } from '@lobechat/observability-otel/modules/onboarding-understanding';
import type { PublicServeOptions, WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import { publishOnboardingGenerationProgress } from '@/server/services/onboardingProgress';
import {
  createUnderstandingService,
  type UnderstandingService,
} from '@/server/services/understanding/service';
import { runStep } from '@/server/workflows/step';

import { observeOnboardingUnderstandingWorkflow } from './observability';
import {
  type ProcessCollectedUnderstandingPayload,
  ProcessCollectedUnderstandingPayloadSchema,
} from './types';

type CollectedService = Pick<
  UnderstandingService,
  'failDetailedPersona' | 'failWriting' | 'processCollected'
>;

type CollectedWorkflowContext = Pick<
  WorkflowContext<ProcessCollectedUnderstandingPayload>,
  'requestPayload' | 'run'
> &
  Partial<Pick<WorkflowContext<ProcessCollectedUnderstandingPayload>, 'headers'>>;

interface CollectedWorkflowDependencies {
  createService?: (userId: string) => Promise<CollectedService>;
  triggerDetailedPersona?: (
    input: ProcessCollectedUnderstandingPayload,
    options: { workflowRunId: string },
  ) => Promise<unknown>;
}

const createService = async (userId: string) =>
  createUnderstandingService({ db: await getServerDB(), userId });

const isStaleSession = (error: unknown) =>
  error instanceof UnderstandingResourceNotFoundError ||
  error instanceof UnderstandingSessionNotFoundError ||
  error instanceof StaleUnderstandingRevisionError ||
  error instanceof StaleUnderstandingSessionError;

/**
 * Writes the quick Understanding proposal and starts detailed persona generation.
 *
 * Use when:
 * - A provider workflow has committed a new source fingerprint
 *
 * Expects:
 * - A fingerprint-scoped payload owned by the onboarding user
 *
 * Returns:
 * - Whether the quick proposal was published for the requested fingerprint
 *
 * Call stack:
 *
 * processCollectedWorkflow
 *   -> {@link processCollectedUnderstanding}
 *     -> UnderstandingService.processCollected
 *       -> OnboardingUnderstandingWorkflow.triggerDetailedPersona
 */
export const processCollectedUnderstanding = async (
  context: CollectedWorkflowContext,
  dependencies: CollectedWorkflowDependencies = {},
) => {
  const payload = ProcessCollectedUnderstandingPayloadSchema.parse(context.requestPayload);
  return observeOnboardingUnderstandingWorkflow(
    context,
    {
      operation: 'workflow.collected',
      sessionId: payload.sessionId,
      topicId: payload.topicId,
    },
    async () => {
      const service = await (dependencies.createService ?? createService)(payload.userId);
      const result = await runStep(context, 'collected:process', async () => {
        try {
          return await service.processCollected({
            expectedSourceFingerprint: payload.sourceFingerprint,
            responseLanguage: payload.responseLanguage,
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
      await observeOnboardingUnderstandingOperation(
        {
          operation: 'progress.publish',
          sessionId: payload.sessionId,
          topicId: payload.topicId,
        },
        () => publishOnboardingGenerationProgress(payload.userId, payload.topicId),
      );
      const triggerDetailedPersona = dependencies.triggerDetailedPersona;
      if (result.published && triggerDetailedPersona) {
        await runStep(context, 'collected:trigger-detailed-persona', () =>
          triggerDetailedPersona(payload, {
            workflowRunId: `onboarding-understanding-detailed-${createHash('sha256')
              .update(payload.sessionId)
              .update('\0')
              .update(payload.sourceFingerprint)
              .update('\0')
              .update(String(result.generationRevision))
              .update('\0')
              .update(String(result.feedbackRevision))
              .digest('hex')
              .slice(0, 32)}`,
          }),
        );
      }
      return result;
    },
  );
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
    if (!failed) {
      const detailedFailed = await service.failDetailedPersona({
        sessionId: payload.sessionId,
        sourceFingerprint: payload.sourceFingerprint,
        topicId: payload.topicId,
      });
      if (detailedFailed)
        await publishOnboardingGenerationProgress(payload.userId, payload.topicId);
      return { failed: Boolean(detailedFailed) };
    }
    await publishOnboardingGenerationProgress(payload.userId, payload.topicId);
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
