import { createHash } from 'node:crypto';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type {
  CreateOnboardingTasksInput,
  OnboardingSuggestedTask,
  OnboardingTaskRecommendationError,
  OnboardingTaskRecommendationPollingResult,
  OnboardingTaskRecommendationSession,
  UserSystemAgentConfig,
} from '@lobechat/types';
import {
  OnboardingTaskRecommendationSessionSchema,
  OnboardingUnderstandingSessionSchema,
} from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { ConnectorDataService } from '@/server/services/connectorData';
import { OnboardingService } from '@/server/services/onboarding';
import { resolveSystemAgentModelConfig } from '@/server/services/systemAgent/modelConfig';

import { TaskRecommendationConfigurator } from './config';
import { TaskRecommendationMaterializer } from './materializer';
import { taskRecommendationProviderMap } from './providers';
import type { TaskRecommendationProvider } from './types';
import { TaskRecommendationWriter } from './writer';

/** Error raised when recommendation state cannot be resolved for the active topic. */
export class TaskRecommendationNotFoundError extends Error {
  constructor() {
    super('Onboarding task recommendations were not found');
    this.name = 'TaskRecommendationNotFoundError';
  }
}

/** Error raised when a client references an obsolete recommendation session. */
export class StaleTaskRecommendationSessionError extends Error {
  constructor() {
    super('Onboarding task recommendations are no longer current');
    this.name = 'StaleTaskRecommendationSessionError';
  }
}

/** One provider result returned to the durable workflow before the session is committed. */
export interface TaskRecommendationProviderResult {
  /** Bounded failure when collection or generation could not produce tasks. */
  error?: OnboardingTaskRecommendationError;
  /** Connector identifier processed by this result. */
  providerId: string;
  /** Validated task recommendations generated from this provider's evidence. */
  recommendations: OnboardingSuggestedTask[];
}

interface TaskRecommendationServiceDependencies {
  configurator: TaskRecommendationConfigurator;
  connectorData: ConnectorDataService;
  materializer: Pick<TaskRecommendationMaterializer, 'materialize'>;
  onboarding: Pick<OnboardingService, 'getInboxAgentId'>;
  providers: ReadonlyMap<string, TaskRecommendationProvider>;
  topic: Pick<TopicModel, 'findById' | 'updateMetadata'>;
  writer: Pick<TaskRecommendationWriter, 'generate'>;
}

const recommendationId = (providerId: string, title: string, instruction: string) =>
  createHash('sha256')
    .update(providerId)
    .update('\0')
    .update(title)
    .update('\0')
    .update(instruction)
    .digest('hex')
    .slice(0, 24);

/** Coordinates persisted onboarding task recommendation generation and materialization. */
export class TaskRecommendationService {
  constructor(private readonly dependencies: TaskRecommendationServiceDependencies) {}

  private activeTopic = async (topicId: string) => {
    const topic = await this.dependencies.topic.findById(topicId);
    if (!topic?.metadata?.onboardingSession || topic.metadata.onboardingSession.finishedAt) {
      throw new TaskRecommendationNotFoundError();
    }
    return topic;
  };

  private persist = async (
    topicId: string,
    session: OnboardingTaskRecommendationSession,
  ): Promise<OnboardingTaskRecommendationSession> => {
    const parsed = OnboardingTaskRecommendationSessionSchema.parse(session);
    await this.dependencies.topic.updateMetadata(topicId, {
      onboardingSession: { taskRecommendations: parsed },
    });
    return parsed;
  };

  private initialize = async (
    topicId: string,
    expectedSourceFingerprint: string,
  ): Promise<OnboardingTaskRecommendationSession> => {
    const topic = await this.activeTopic(topicId);
    if (topic.metadata!.onboardingSession!.taskRecommendations) {
      return OnboardingTaskRecommendationSessionSchema.parse(
        topic.metadata!.onboardingSession!.taskRecommendations,
      );
    }

    const understanding = OnboardingUnderstandingSessionSchema.safeParse(
      topic.metadata!.onboardingSession!.understanding,
    );
    if (!understanding.success) throw new TaskRecommendationNotFoundError();
    const hasCompletedTriggerSource = expectedSourceFingerprint.split(',').every((part) => {
      const [providerId, revision] = part.split('@');
      const source = understanding.data.sources[providerId];
      return source?.status === 'completed' && source.revision === Number(revision);
    });
    if (!hasCompletedTriggerSource) throw new TaskRecommendationNotFoundError();

    // Recommendation providers collect connector data independently. The first completed
    // Understanding source controls when generation starts, not which selected connectors it uses.
    const providerIds = Object.keys(understanding.data.sources)
      .filter((providerId) => this.dependencies.providers.has(providerId))
      .sort();
    if (providerIds.length === 0) throw new TaskRecommendationNotFoundError();

    const now = new Date().toISOString();
    return this.persist(topicId, {
      createdTaskIds: {},
      errors: [],
      id: understanding.data.id,
      providerIds,
      recommendations: [],
      sourceFingerprint: expectedSourceFingerprint,
      status: 'pending',
      updatedAt: now,
    });
  };

  /**
   * Returns the latest recommendation state for polling.
   *
   * Use when:
   * - The Starter Tasks UI polls workflow progress
   * - A curl client inspects generated recommendations
   *
   * Expects:
   * - An automatically initialized recommendation session on the active onboarding topic
   *
   * Returns:
   * - Parsed persisted state without connector evidence or credentials
   */
  get = async (topicId: string): Promise<OnboardingTaskRecommendationPollingResult> => {
    const topic = await this.activeTopic(topicId);
    if (!topic.metadata?.onboardingSession?.taskRecommendations) {
      throw new TaskRecommendationNotFoundError();
    }
    return OnboardingTaskRecommendationSessionSchema.parse(
      topic.metadata.onboardingSession.taskRecommendations,
    );
  };

  /**
   * Marks a pending session as processing and returns its provider budget.
   *
   * Use when:
   * - The durable workflow begins or replays its first state transition
   *
   * Expects:
   * - A session ID matching the first completed Understanding session
   *
   * Returns:
   * - Provider IDs, per-provider budget, and whether generation work remains
   */
  begin = async (topicId: string, sessionId: string, sourceFingerprint: string) => {
    const session = await this.initialize(topicId, sourceFingerprint);
    if (session.id !== sessionId) throw new StaleTaskRecommendationSessionError();
    const ready =
      session.sourceFingerprint === sourceFingerprint &&
      (session.status === 'pending' || session.status === 'processing');
    if (ready && session.status === 'pending') {
      await this.persist(topicId, {
        ...session,
        status: 'processing',
        updatedAt: new Date().toISOString(),
      });
    }
    return {
      limit: this.dependencies.configurator.recommendationsPerProvider(session.providerIds.length),
      providerIds: session.providerIds,
      ready,
    };
  };

  /**
   * Generates recommendations for one connector using only its collected evidence.
   *
   * Use when:
   * - A provider-specific durable workflow step runs independently
   *
   * Expects:
   * - A supported provider, positive recommendation limit, and response locale
   *
   * Returns:
   * - Validated recommendations or a bounded provider failure
   */
  generateProvider = async (
    providerId: string,
    limit: number,
    responseLanguage: string,
  ): Promise<TaskRecommendationProviderResult> => {
    const provider = this.dependencies.providers.get(providerId);
    if (!provider || (providerId !== 'github' && providerId !== 'gmail')) {
      return {
        error: {
          code: 'TASK_RECOMMENDATION_PROVIDER_UNAVAILABLE',
          providerId,
          retryable: false,
        },
        providerId,
        recommendations: [],
      };
    }
    const collected = await provider.collect({ connectorData: this.dependencies.connectorData });
    if (!collected.context || collected.signalCount === 0) {
      return {
        error: { code: 'TASK_RECOMMENDATION_SIGNALS_EMPTY', providerId, retryable: false },
        providerId,
        recommendations: [],
      };
    }

    const output = await this.dependencies.writer.generate({
      context: collected.context,
      guide: this.dependencies.configurator.providers[providerId],
      limit,
      providerId,
      responseLanguage,
      writingGuide: this.dependencies.configurator.writing,
    });
    const allowedSources = new Map(collected.sources.map((source) => [source.url, source]));
    const recommendations = output
      .slice(0, limit)
      .map((item) => {
        const sources = [...new Set(item.sourceUrls)]
          .slice(0, this.dependencies.configurator.writing.maxSourcesPerRecommendation)
          .flatMap((url) => {
            const source = allowedSources.get(url);
            return source ? [source] : [];
          });
        return {
          checked: true,
          id: recommendationId(providerId, item.title, item.instruction),
          instruction: item.instruction,
          providerId,
          reason: item.reason,
          sources,
          title: item.title,
        };
      })
      .filter(({ sources }) => sources.length > 0);
    return recommendations.length > 0
      ? { providerId, recommendations }
      : {
          error: { code: 'TASK_RECOMMENDATION_GENERATION_EMPTY', providerId, retryable: true },
          providerId,
          recommendations: [],
        };
  };

  /**
   * Commits all independent provider results as one terminal polling state.
   *
   * Use when:
   * - Every provider step has returned success or a bounded failure
   *
   * Expects:
   * - Results belonging to the current immutable recommendation session
   *
   * Returns:
   * - The completed, partial, or failed persisted session
   */
  commit = async (
    topicId: string,
    sessionId: string,
    results: TaskRecommendationProviderResult[],
  ): Promise<OnboardingTaskRecommendationSession> => {
    const session = await this.get(topicId);
    if (session.id !== sessionId) throw new StaleTaskRecommendationSessionError();
    if (session.status === 'completed' || session.status === 'partial') return session;
    const recommendations = results
      .flatMap(({ recommendations }) => recommendations)
      .toSorted(
        (left, right) =>
          left.providerId.localeCompare(right.providerId) || left.title.localeCompare(right.title),
      );
    const errors = results.flatMap(({ error }) => (error ? [error] : []));
    const now = new Date().toISOString();
    return this.persist(topicId, {
      ...session,
      completedAt: now,
      errors,
      recommendations,
      status: recommendations.length === 0 ? 'failed' : errors.length > 0 ? 'partial' : 'completed',
      updatedAt: now,
    });
  };

  /**
   * Terminalizes a running workflow that failed outside a provider boundary.
   *
   * Use when:
   * - The Upstash workflow failure callback runs after retries are exhausted
   *
   * Expects:
   * - The current immutable recommendation session
   *
   * Returns:
   * - Whether the session was changed to failed
   */
  fail = async (topicId: string, sessionId: string): Promise<boolean> => {
    const session = await this.get(topicId);
    if (session.id !== sessionId || session.status !== 'processing') return false;
    const now = new Date().toISOString();
    await this.persist(topicId, {
      ...session,
      completedAt: now,
      errors: [
        ...session.errors,
        { code: 'TASK_RECOMMENDATION_WORKFLOW_FAILED', providerId: 'workflow', retryable: true },
      ],
      status: 'failed',
      updatedAt: now,
    });
    return true;
  };

  /**
   * Creates real private Inbox tasks from selected recommendations.
   *
   * Use when:
   * - The user confirms selections in the final onboarding step
   *
   * Expects:
   * - Recommendation IDs from the current completed or partial session
   *
   * Returns:
   * - Stable recommendation-to-task mappings, reusing prior mappings on retries
   */
  createTasks = async (input: CreateOnboardingTasksInput): Promise<Record<string, string>> => {
    const session = await this.get(input.topicId);
    if (session.id !== input.sessionId) throw new StaleTaskRecommendationSessionError();
    const selected = new Set(input.recommendationIds);
    const recommendations = session.recommendations.filter(({ id }) => selected.has(id));
    if (recommendations.length !== selected.size) throw new TaskRecommendationNotFoundError();
    const inboxAgentId = await this.dependencies.onboarding.getInboxAgentId();

    for (const recommendation of recommendations) {
      const result = await this.dependencies.materializer.materialize({
        assigneeAgentId: inboxAgentId,
        recommendationId: recommendation.id,
        sessionId: input.sessionId,
        topicId: input.topicId,
      });
      if (result.status === 'stale') throw new StaleTaskRecommendationSessionError();
      if (result.status === 'not-found') throw new TaskRecommendationNotFoundError();
    }
    return (await this.get(input.topicId)).createdTaskIds;
  };
}

interface CreateTaskRecommendationServiceOptions {
  db: LobeChatDatabase;
  userId: string;
}

/** Creates a personal-scope onboarding task recommendation service. */
export const createTaskRecommendationService = async ({
  db,
  userId,
}: CreateTaskRecommendationServiceOptions): Promise<TaskRecommendationService> => {
  const agentModel = new AgentModel(db, userId);
  const userModel = new UserModel(db, userId);
  return new TaskRecommendationService({
    configurator: new TaskRecommendationConfigurator(),
    connectorData: new ConnectorDataService(db, userId),
    materializer: new TaskRecommendationMaterializer(db, userId),
    onboarding: new OnboardingService(db, userId),
    providers: taskRecommendationProviderMap,
    topic: new TopicModel(db, userId),
    writer: new TaskRecommendationWriter({
      generator: new AiGenerationService(db, userId),
      writerAgent: async () => {
        const writerAgent = await agentModel.getBuiltinAgent(
          BUILTIN_AGENT_SLUGS.onboardingTaskRecommender,
        );
        if (!writerAgent) throw new Error('Onboarding task recommendation agent is unavailable');
        const settings = await userModel.getUserSettings();
        const userSystemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
        const userConfig = userSystemAgent?.onboardingTaskRecommender;
        const serverConfig = parseSystemAgent(appEnv.SYSTEM_AGENT).onboardingTaskRecommender;
        const modelConfig = await resolveSystemAgentModelConfig({
          override: userConfig,
          taskConfig: serverConfig,
          taskKey: 'onboardingTaskRecommender',
        });
        return { ...modelConfig, id: writerAgent.id };
      },
    }),
  });
};
