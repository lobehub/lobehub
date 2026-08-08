import { errorNameFrom } from '@lobechat/utils';
import type { PublicServeOptions, WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import {
  createTaskRecommendationService,
  type TaskRecommendationProviderResult,
  type TaskRecommendationService,
} from '@/server/services/taskRecommendation/service';

import {
  type ProcessOnboardingTaskRecommendationPayload,
  ProcessOnboardingTaskRecommendationPayloadSchema,
} from './types';

type RecommendationWorkflowService = Pick<
  TaskRecommendationService,
  'begin' | 'commit' | 'fail' | 'generateProvider' | 'get'
>;

type RecommendationWorkflowContext = Pick<
  WorkflowContext<ProcessOnboardingTaskRecommendationPayload>,
  'requestPayload' | 'run'
>;

interface RecommendationWorkflowDependencies {
  createService?: (userId: string) => Promise<RecommendationWorkflowService>;
}

const createService = async (userId: string) =>
  createTaskRecommendationService({ db: await getServerDB(), userId });

/**
 * Runs independent provider generation steps and commits one polling result.
 *
 * Call stack:
 *
 * processOnboardingTaskRecommendations
 *   -> {@link TaskRecommendationService.begin}
 *     -> {@link TaskRecommendationService.generateProvider}[]
 *       -> {@link TaskRecommendationService.commit}
 */
export const processOnboardingTaskRecommendations = async (
  context: RecommendationWorkflowContext,
  dependencies: RecommendationWorkflowDependencies = {},
) => {
  const payload = ProcessOnboardingTaskRecommendationPayloadSchema.parse(context.requestPayload);
  const service = await (dependencies.createService ?? createService)(payload.userId);
  const plan = await context.run('session:begin', () =>
    service.begin(payload.topicId, payload.sessionId, payload.sourceFingerprint),
  );
  if (!plan.ready) return service.get(payload.topicId);

  const results = await Promise.all(
    plan.providerIds.map((providerId) =>
      context.run(
        `provider:${providerId}:generate`,
        async (): Promise<TaskRecommendationProviderResult> => {
          try {
            return await service.generateProvider(providerId, plan.limit, payload.responseLanguage);
          } catch (error) {
            console.error('[taskRecommendation:provider]', {
              errorName: errorNameFrom(error) ?? 'UnknownError',
              providerId,
            });
            return {
              error: {
                code: 'TASK_RECOMMENDATION_PROVIDER_FAILED',
                providerId,
                retryable: true,
              },
              providerId,
              recommendations: [],
            };
          }
        },
      ),
    ),
  );
  return context.run('session:commit', () =>
    service.commit(payload.topicId, payload.sessionId, results),
  );
};

/** Terminalizes a recommendation session after workflow-level retries are exhausted. */
export const failOnboardingTaskRecommendations = async (
  input: unknown,
  dependencies: RecommendationWorkflowDependencies = {},
) => {
  const payload = ProcessOnboardingTaskRecommendationPayloadSchema.parse(input);
  const service = await (dependencies.createService ?? createService)(payload.userId);
  return service.fail(payload.topicId, payload.sessionId);
};

/** Upstash parser and failure callback for the recommendation workflow endpoint. */
export const processOnboardingTaskRecommendationWorkflowOptions = {
  failureFunction: async ({
    context: { requestPayload },
  }: {
    context: { requestPayload?: unknown };
  }) => {
    const parsed = ProcessOnboardingTaskRecommendationPayloadSchema.safeParse(requestPayload);
    if (!parsed.success) return 'invalid-payload';
    return (await failOnboardingTaskRecommendations(parsed.data))
      ? 'session-failed'
      : 'not-current';
  },
  initialPayloadParser: (input: string) =>
    ProcessOnboardingTaskRecommendationPayloadSchema.parse(JSON.parse(input)),
} satisfies PublicServeOptions<ProcessOnboardingTaskRecommendationPayload>;
