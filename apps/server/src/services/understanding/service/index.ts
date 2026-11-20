import { createHash, randomUUID } from 'node:crypto';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import {
  getUnderstandingSourceFingerprint,
  OnboardingUnderstandingRepository,
  UnderstandingPreconditionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import { observeOnboardingUnderstandingOperation } from '@lobechat/observability-otel/modules/onboarding-understanding';
import type {
  ConfirmOnboardingUnderstandingInput,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingSession,
  RetryOnboardingUnderstandingProviderInput,
  ReviseOnboardingUnderstandingInput,
} from '@lobechat/types';
import { projectOnboardingUnderstandingSessionStatus } from '@lobechat/types';
import pMap from 'p-map';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { ConnectorDataService } from '@/server/services/connectorData';
import { OnboardingUnderstandingWorkflow } from '@/server/workflows/onboardingUnderstanding';

import { understandingProviderMap } from '../providers';
import { UnderstandingSourceStore } from '../sourceStore';
import type { UnderstandingProvider } from '../types';
import * as detailedPersona from './detailedPersona';
import * as providerCollection from './providerCollection';
import { readActiveSession } from './session';
import type {
  ProcessCollectedInput,
  ProviderOperationInput,
  UnderstandingServiceDependencies,
} from './types';
import { PROVIDER_IO_CONCURRENCY, storedProposal } from './utils';
import * as writing from './writing';

export { UnderstandingProviderContextUnavailableError } from './errors';
export type { UnderstandingServiceDependencies } from './types';

/** Controls optional downstream work started with an Understanding collection run. */
export interface UnderstandingStartOptions {
  /**
   * Starts task recommendations as soon as the first source completes.
   *
   * @default true
   */
  triggerTaskRecommendations?: boolean;
}

export class UnderstandingService {
  constructor(private readonly dependencies: UnderstandingServiceDependencies) {}

  /**
   * Lists Understanding providers backed by a currently resolvable connector client.
   *
   * Use when:
   * - The onboarding UI needs to distinguish supported apps from usable data sources
   * - Session initialization must exclude disconnected or remotely deleted connectors
   *
   * Expects:
   * - The service dependencies are scoped to the authenticated user
   *
   * Returns:
   * - Available provider identifiers in deterministic provider-map order
   */
  listSourceProviderIds = async (): Promise<string[]> =>
    this.dependencies.connectorData.listAvailableProviderIds([
      ...this.dependencies.providers.keys(),
    ]);

  private initialize = async (
    topicId: string,
    selectedProviderIds?: string[],
  ): Promise<OnboardingUnderstandingSession> =>
    observeOnboardingUnderstandingOperation({ operation: 'initialize', topicId }, async () => {
      await observeOnboardingUnderstandingOperation(
        { operation: 'topic.assert-active', topicId },
        () => this.dependencies.topic.assertActiveOnboardingTopic(topicId),
      );

      const current = await observeOnboardingUnderstandingOperation(
        { operation: 'session.read', topicId },
        () => this.dependencies.repository.get(topicId),
      );
      if (current) return current;

      const requestedProviderIds = selectedProviderIds
        ? [...new Set(selectedProviderIds)].sort()
        : [...this.dependencies.providers.keys()].sort();
      if (requestedProviderIds.some((providerId) => !this.dependencies.providers.has(providerId))) {
        throw new UnderstandingResourceNotFoundError('session');
      }
      const availableProviderIds = new Set(
        await observeOnboardingUnderstandingOperation(
          { operation: 'provider.resolve-available', topicId },
          () => this.listSourceProviderIds(),
        ),
      );
      const providerIds = requestedProviderIds.filter((providerId) =>
        availableProviderIds.has(providerId),
      );
      const sessionId = this.dependencies.ids();
      return observeOnboardingUnderstandingOperation(
        { operation: 'session.persist', sessionId, topicId },
        () => this.dependencies.repository.initialize(topicId, sessionId, providerIds),
      );
    });

  start = async (
    topicId: string,
    responseLanguage: string,
    selectedProviderIds?: string[],
    options: UnderstandingStartOptions = {},
  ): Promise<OnboardingUnderstandingPollingResult> => {
    const startedAt = Date.now();
    return observeOnboardingUnderstandingOperation(
      { operation: 'session.start', topicId },
      async () => {
        OnboardingUnderstandingWorkflow.assertAvailable();

        const session = await this.initialize(topicId, selectedProviderIds);
        const providers = Object.entries(session.sources)
          .filter(([, state]) => state.status === 'pending')
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([id, state]) => ({ id, revision: state.revision + 1 }));
        if (providers.length > 0) {
          await observeOnboardingUnderstandingOperation(
            { operation: 'workflow.trigger', sessionId: session.id, topicId },
            () =>
              OnboardingUnderstandingWorkflow.triggerProviders(
                {
                  providers,
                  responseLanguage,
                  sessionId: session.id,
                  startedAt,
                  triggerTaskRecommendations: options.triggerTaskRecommendations,
                  topicId,
                  userId: this.dependencies.userId,
                },
                { workflowRunId: `onboarding-understanding-initial-${session.id}` },
              ),
          );
        }
        return this.get(topicId);
      },
    );
  };

  revise = async (
    input: ReviseOnboardingUnderstandingInput,
  ): Promise<OnboardingUnderstandingPollingResult> => {
    OnboardingUnderstandingWorkflow.assertAvailable();
    await this.activeSession(input.topicId, input.sessionId);
    const requestedProviderIds = [...new Set(input.providerIds)].sort();
    if (requestedProviderIds.some((providerId) => !this.dependencies.providers.has(providerId))) {
      throw new UnderstandingResourceNotFoundError('session');
    }
    const availableProviderIds = new Set(await this.listSourceProviderIds());
    const providerIds = requestedProviderIds.filter((providerId) =>
      availableProviderIds.has(providerId),
    );

    const { attempts: providerAttempts, session: next } = await this.dependencies.repository.extend(
      {
        expectedFeedbackRevision: input.expectedFeedbackRevision,
        feedback: input.feedback,
        providerIds,
        sessionId: input.sessionId,
        topicId: input.topicId,
      },
    );
    const completedProviders = Object.entries(next.sources).filter(
      ([, state]) => state.status === 'completed',
    );
    const sourceStore = completedProviders.length > 0 ? this.dependencies.sourceStore() : undefined;
    const storedContexts = sourceStore
      ? await pMap(
          completedProviders,
          ([providerId, state]) =>
            sourceStore.get({
              providerId,
              revision: state.revision,
              sessionId: input.sessionId,
              userId: this.dependencies.userId,
            }),
          { concurrency: PROVIDER_IO_CONCURRENCY },
        )
      : [];
    const expiredProviders = completedProviders.flatMap(([providerId, state], index) =>
      storedContexts[index] ? [] : [{ providerId, revision: state.revision }],
    );
    const currentSourceFingerprint = getUnderstandingSourceFingerprint(next);
    const availableSession =
      expiredProviders.length > 0 && currentSourceFingerprint
        ? await this.dependencies.repository.expireProviderContexts({
            providers: expiredProviders,
            sessionId: input.sessionId,
            sourceFingerprint: currentSourceFingerprint,
            topicId: input.topicId,
          })
        : next;
    const recollectedProviders = await pMap(
      expiredProviders,
      async ({ providerId }) => ({
        id: providerId,
        ...(await this.dependencies.repository.markProviderRunning(
          input.topicId,
          input.sessionId,
          providerId,
        )),
      }),
      { concurrency: PROVIDER_IO_CONCURRENCY },
    );
    const attempts = [...providerAttempts, ...recollectedProviders].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    if (attempts.length > 0) {
      try {
        await OnboardingUnderstandingWorkflow.triggerProviders(
          {
            providers: attempts,
            responseLanguage: input.responseLanguage,
            sessionId: input.sessionId,
            startedAt: Date.now(),
            topicId: input.topicId,
            userId: this.dependencies.userId,
          },
          {
            workflowRunId: `onboarding-understanding-extend-${input.sessionId}-${next.feedback?.revision ?? 0}-${attempts.map(({ id, revision }) => `${id}-${revision}`).join('-')}`,
          },
        );
      } catch (triggerError) {
        // Best effort: every attempt is marked failed even if some writes
        // reject, and the trigger error is what the caller sees.
        await pMap(
          attempts,
          ({ id, revision }) =>
            this.failProvider({
              providerId: id,
              revision,
              sessionId: input.sessionId,
              topicId: input.topicId,
            }).catch(() => undefined),
          { concurrency: PROVIDER_IO_CONCURRENCY },
        );
        throw triggerError;
      }
    }

    const sourceFingerprint = getUnderstandingSourceFingerprint(availableSession);
    if (input.feedback?.trim() && sourceFingerprint) {
      await OnboardingUnderstandingWorkflow.triggerWriting(
        {
          sessionId: input.sessionId,
          responseLanguage: input.responseLanguage,
          sourceFingerprint,
          startedAt: Date.now(),
          topicId: input.topicId,
          userId: this.dependencies.userId,
        },
        {
          workflowRunId: `onboarding-understanding-feedback-${createHash('sha256')
            .update(input.sessionId)
            .update('\0')
            .update(sourceFingerprint)
            .update('\0')
            .update(String(next.feedback?.revision ?? 0))
            .digest('hex')
            .slice(0, 32)}`,
        },
      );
    }

    return this.get(input.topicId);
  };

  get = async (topicId: string): Promise<OnboardingUnderstandingPollingResult> => {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const session = await this.dependencies.repository.get(topicId);
    if (!session) throw new UnderstandingSessionNotFoundError(topicId);
    let proposal: OnboardingUnderstandingMessageMetadata | undefined;
    if (session.writing?.resultMessageId) {
      const message = await this.dependencies.messages.findById(session.writing.resultMessageId);
      proposal = storedProposal(message?.metadata);
    }
    return {
      confirmed: Boolean(session.confirmedAt),
      feedback: session.feedback,
      generationRevision: session.generationRevision,
      id: session.id,
      ...(proposal ? { proposal } : {}),
      sources: session.sources,
      status: projectOnboardingUnderstandingSessionStatus(session),
      ...(session.writing ? { writing: session.writing } : {}),
    };
  };

  retry = async (
    input: RetryOnboardingUnderstandingProviderInput,
  ): Promise<OnboardingUnderstandingPollingResult> => {
    OnboardingUnderstandingWorkflow.assertAvailable();
    const session = await this.activeSession(input.topicId, input.sessionId);
    const state = session.sources[input.providerId];
    if (!this.dependencies.providers.has(input.providerId) || !state) {
      throw new UnderstandingResourceNotFoundError('session');
    }
    if (state.status !== 'failed') {
      throw new UnderstandingPreconditionError('source_not_retryable');
    }
    if (!state.errors.some(({ retryable }) => retryable)) return this.get(input.topicId);
    const availableProviderIds = await this.dependencies.connectorData.listAvailableProviderIds([
      input.providerId,
    ]);
    if (!availableProviderIds.includes(input.providerId)) return this.get(input.topicId);
    const { revision } = await this.dependencies.repository.markProviderRunning(
      input.topicId,
      input.sessionId,
      input.providerId,
    );
    try {
      await OnboardingUnderstandingWorkflow.triggerProviders(
        {
          providers: [{ id: input.providerId, revision }],
          responseLanguage: input.responseLanguage,
          sessionId: input.sessionId,
          startedAt: Date.now(),
          topicId: input.topicId,
          userId: this.dependencies.userId,
        },
        {
          workflowRunId: `onboarding-understanding-retry-${input.sessionId}-${input.providerId}-${revision}`,
        },
      );
    } catch (triggerError) {
      try {
        await this.failProvider({ ...input, revision });
      } catch (compensationError) {
        console.error('[understanding:retryCompensation]', {
          errorName: compensationError instanceof Error ? compensationError.name : 'UnknownError',
        });
      }
      throw triggerError;
    }
    return this.get(input.topicId);
  };

  processProvider = (input: ProviderOperationInput) =>
    providerCollection.processProvider(this.dependencies, input);

  failProvider = (input: ProviderOperationInput) =>
    providerCollection.failProvider(this.dependencies, input);

  processCollected = (input: ProcessCollectedInput) =>
    writing.processCollected(this.dependencies, input);

  failWriting = (input: Parameters<typeof writing.failWriting>[1]) =>
    writing.failWriting(this.dependencies, input);

  processDetailedPersona = (input: ProcessCollectedInput) =>
    detailedPersona.processDetailedPersona(this.dependencies, input);

  failDetailedPersona = (input: Parameters<typeof detailedPersona.failDetailedPersona>[1]) =>
    detailedPersona.failDetailedPersona(this.dependencies, input);

  confirm = (input: ConfirmOnboardingUnderstandingInput) =>
    this.dependencies.repository.confirm(input);

  private activeSession = (topicId: string, sessionId: string) =>
    readActiveSession(this.dependencies, topicId, sessionId);
}

interface CreateUnderstandingServiceOptions {
  db: LobeChatDatabase;
  providers?: readonly UnderstandingProvider[];
  userId: string;
  workspaceId?: string;
}

export const createUnderstandingService = async ({
  db,
  providers,
  userId,
  workspaceId,
}: CreateUnderstandingServiceOptions): Promise<UnderstandingService> => {
  if (workspaceId) throw new Error('Onboarding Understanding is available only in personal scope');

  const messageModel = new MessageModel(db, userId);
  const topicModel = new TopicModel(db, userId);
  const aiGenerationService = new AiGenerationService(db, userId);

  return new UnderstandingService({
    connectorData: new ConnectorDataService(db, userId),
    generator: aiGenerationService,
    ids: randomUUID,
    messages: {
      create: (params) => messageModel.create(params),
      findById: (id) => messageModel.findById(id),
      findLatestAssistantMessageByThread: async (input) => {
        const message = await messageModel.findLatestAssistantMessageByThread(input);
        return message
          ? {
              content: message.content,
              error: message.error,
              id: message.id,
              role: message.role,
              threadId: message.threadId,
            }
          : message;
      },
    },
    persona: new UserPersonaModel(db, userId),
    providers: providers
      ? new Map(providers.map((provider) => [provider.id, provider]))
      : understandingProviderMap,
    repository: new OnboardingUnderstandingRepository(db, userId),
    sourceStore: () => new UnderstandingSourceStore(),
    topic: {
      assertActiveOnboardingTopic: async (topicId) => {
        const topic = await topicModel.findById(topicId);
        const onboarding = topic?.metadata?.onboardingSession;
        if (!topic || !onboarding || onboarding.finishedAt) {
          throw new UnderstandingResourceNotFoundError('topic');
        }
      },
    },
    userId,
    writerAgent: async () => {
      const agentModel = new AgentModel(db, userId);
      const writerAgent = await agentModel.getBuiltinAgent(
        BUILTIN_AGENT_SLUGS.onboardingUnderstanding,
      );
      if (!writerAgent) throw new Error('Onboarding Understanding agent is unavailable');
      const modelConfig = await agentModel.getAgentModelConfig(writerAgent.id);
      if (!modelConfig) throw new Error('Onboarding Understanding agent is unavailable');
      return { ...modelConfig, id: writerAgent.id };
    },
  });
};
