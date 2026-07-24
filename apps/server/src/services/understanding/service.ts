import { createHash, randomUUID } from 'node:crypto';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { ConnectorDataError } from '@lobechat/connector-data';
import {
  getUnderstandingSourceFingerprint,
  OnboardingUnderstandingRepository,
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
  UnderstandingPreconditionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import {
  chainUnderstandingPersona,
  UNDERSTANDING_ANALYSIS_JSON_SCHEMA,
} from '@lobechat/prompts/understanding';
import type {
  CollectionDiagnostics,
  ConfirmOnboardingUnderstandingInput,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingSession,
  RetryOnboardingUnderstandingProviderInput,
  ReviseOnboardingUnderstandingInput,
  UnderstandingFeedbackTurn,
} from '@lobechat/types';
import {
  MAX_COLLECTION_ERRORS,
  OnboardingUnderstandingMessageMetadataSchema,
  projectOnboardingUnderstandingSessionStatus,
  RequestTrigger,
  UnderstandingAnalysisSchema,
} from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { ConnectorDataService } from '@/server/services/connectorData';

import { understandingProviderMap } from './providers';
import {
  boundCanonicalDiagnostics,
  canonicalCollectionError,
  MAX_AGENT_INPUT_LENGTH,
  MAX_SOURCE_BRIEF_LENGTH,
  sanitizeProviderDiagnostics,
} from './sanitizer';
import type { StoredUnderstandingProviderContext } from './sourceStore';
import { UnderstandingSourceStore } from './sourceStore';
import type { UnderstandingProvider } from './types';

const BASELINE_MAX_LENGTH = 8_000;

interface ProviderOperationInput {
  providerId: string;
  revision: number;
  sessionId: string;
  topicId: string;
}

interface ProcessCollectedInput {
  expectedSourceFingerprint: string;
  sessionId: string;
  topicId: string;
}

type UnderstandingRepository = Pick<
  OnboardingUnderstandingRepository,
  | 'commitWriting'
  | 'completeProvider'
  | 'confirm'
  | 'expireProviderContexts'
  | 'extend'
  | 'failProvider'
  | 'failWriting'
  | 'get'
  | 'initialize'
  | 'markProviderRunning'
  | 'prepareWriting'
>;

type UnderstandingContexts = Pick<UnderstandingSourceStore, 'get' | 'put'>;

export interface UnderstandingServiceDependencies {
  connectorData: ConnectorDataService;
  generator: Pick<AiGenerationService, 'generateObject'>;
  ids: () => string;
  messages: {
    create: (params: {
      agentId: string;
      content: string;
      model: string;
      provider: string;
      role: 'assistant';
      threadId: string;
      topicId: string;
    }) => Promise<{ id: string }>;
    findById: (id: string) => Promise<{ content?: unknown; metadata?: unknown } | null | undefined>;
    findLatestAssistantMessageByThread: (input: {
      agentId: string;
      threadId: string;
      topicId: string;
    }) => Promise<
      | { content?: unknown; error?: unknown; id: string; role: string; threadId?: string | null }
      | null
      | undefined
    >;
  };
  persona: {
    getLatestPersonaDocument: () => Promise<
      { persona?: string | null; tagline?: string | null } | null | undefined
    >;
  };
  providers: ReadonlyMap<string, UnderstandingProvider>;
  repository: UnderstandingRepository;
  sourceStore: () => UnderstandingContexts;
  topic: {
    assertActiveOnboardingTopic: (topicId: string) => Promise<void>;
  };
  userId: string;
  writerAgent: () => Promise<{ id: string; model: string; provider: string }>;
}

export class UnderstandingProviderContextUnavailableError extends Error {
  constructor() {
    super('Current onboarding Understanding provider context is unavailable');
    this.name = 'UnderstandingProviderContextUnavailableError';
  }
}

const parseStoredAnalysis = (content: unknown) => {
  if (typeof content !== 'string') return;
  try {
    const parsed = UnderstandingAnalysisSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return;
  }
};

const writingThreadId = (sessionId: string, sourceFingerprint: string, feedbackRevision: number) =>
  `thd_${createHash('sha256')
    .update(sessionId)
    .update('\0')
    .update(sourceFingerprint)
    .update('\0')
    .update(String(feedbackRevision))
    .digest('hex')
    .slice(0, 24)}`;

const sumDiagnostics = (
  session: OnboardingUnderstandingSession,
  contexts: StoredUnderstandingProviderContext[],
): CollectionDiagnostics => {
  const terminalSources = Object.values(session.sources).filter(
    ({ status }) => status === 'completed' || status === 'failed',
  );
  return boundCanonicalDiagnostics({
    errors: terminalSources.flatMap(({ errors }) => errors).slice(-MAX_COLLECTION_ERRORS),
    evidenceCount: contexts.reduce(
      (total, { diagnostics }) => total + diagnostics.evidenceCount,
      0,
    ),
    failedCount: terminalSources.reduce((total, source) => total + source.failedCount, 0),
    succeededCount: terminalSources.reduce((total, source) => total + source.succeededCount, 0),
  });
};

const buildEphemeralDocument = (
  contexts: StoredUnderstandingProviderContext[],
  baseline?: { persona?: string | null; tagline?: string | null } | null,
) => {
  const baselineContent = [baseline?.tagline, baseline?.persona]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n\n')
    .slice(0, BASELINE_MAX_LENGTH);
  const baselineSection = baselineContent
    ? `<current-persona-baseline>\n${baselineContent}\n</current-persona-baseline>\n\n`
    : '';
  const delimiters = contexts.map(({ providerId, revision }) => ({
    close: '\n</provider-context>',
    open: `<provider-context provider="${providerId}" revision="${revision}">\n`,
  }));
  const structuralLength =
    baselineSection.length +
    Math.max(0, contexts.length - 1) * 2 +
    delimiters.reduce(
      (total, delimiter) => total + delimiter.open.length + delimiter.close.length,
      0,
    );
  if (structuralLength > MAX_AGENT_INPUT_LENGTH) {
    throw new UnderstandingProviderContextUnavailableError();
  }
  let remainingContent = MAX_AGENT_INPUT_LENGTH - structuralLength;
  const providerSections = contexts.map(({ context }, index) => {
    const remainingProviders = contexts.length - index;
    const content = context.slice(0, Math.floor(remainingContent / remainingProviders));
    remainingContent -= content.length;
    return `${delimiters[index].open}${content}${delimiters[index].close}`;
  });
  return `${baselineSection}${providerSections.join('\n\n')}`;
};

const storedProposal = (metadata: unknown) => {
  if (!isPlainRecord(metadata)) return;
  const parsed = OnboardingUnderstandingMessageMetadataSchema.safeParse(
    metadata.onboardingUnderstanding,
  );
  return parsed.success ? parsed.data : undefined;
};

export class UnderstandingService {
  constructor(private readonly dependencies: UnderstandingServiceDependencies) {}

  private initialize = async (
    topicId: string,
    selectedProviderIds?: string[],
  ): Promise<OnboardingUnderstandingSession> => {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const current = await this.dependencies.repository.get(topicId);
    if (current) return current;
    const providerIds = selectedProviderIds
      ? [...new Set(selectedProviderIds)].sort()
      : [...this.dependencies.providers.keys()].sort();
    if (providerIds.some((providerId) => !this.dependencies.providers.has(providerId))) {
      throw new UnderstandingResourceNotFoundError('session');
    }
    return this.dependencies.repository.initialize(topicId, this.dependencies.ids(), providerIds);
  };

  start = async (
    topicId: string,
    selectedProviderIds?: string[],
  ): Promise<OnboardingUnderstandingPollingResult> => {
    const { OnboardingUnderstandingWorkflow } =
      await import('@/server/workflows/onboardingUnderstanding');
    OnboardingUnderstandingWorkflow.assertAvailable();
    const session = await this.initialize(topicId, selectedProviderIds);
    const providers = Object.entries(session.sources)
      .filter(([, state]) => state.status === 'pending')
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([id, state]) => ({ id, revision: state.revision + 1 }));
    if (providers.length > 0) {
      await OnboardingUnderstandingWorkflow.triggerProviders(
        {
          providers,
          sessionId: session.id,
          topicId,
          userId: this.dependencies.userId,
        },
        { workflowRunId: `onboarding-understanding-initial-${session.id}` },
      );
    }
    return this.get(topicId);
  };

  revise = async (
    input: ReviseOnboardingUnderstandingInput,
  ): Promise<OnboardingUnderstandingPollingResult> => {
    const { OnboardingUnderstandingWorkflow } =
      await import('@/server/workflows/onboardingUnderstanding');
    OnboardingUnderstandingWorkflow.assertAvailable();
    const current = await this.activeSession(input.topicId, input.sessionId);
    const providerIds = [...new Set(input.providerIds)].sort();
    if (providerIds.some((providerId) => !this.dependencies.providers.has(providerId))) {
      throw new UnderstandingResourceNotFoundError('session');
    }

    const next = await this.dependencies.repository.extend({
      expectedFeedbackRevision: input.expectedFeedbackRevision,
      feedback: input.feedback,
      providerIds,
      sessionId: input.sessionId,
      topicId: input.topicId,
    });
    const addedProviders = providerIds
      .filter((providerId) => !current.sources[providerId])
      .map((id) => ({ id, revision: 1 }));
    const completedProviders = Object.entries(next.sources).filter(
      ([, state]) => state.status === 'completed',
    );
    const sourceStore = completedProviders.length > 0 ? this.dependencies.sourceStore() : undefined;
    const storedContexts = sourceStore
      ? await Promise.all(
          completedProviders.map(([providerId, state]) =>
            sourceStore.get({
              providerId,
              revision: state.revision,
              sessionId: input.sessionId,
              userId: this.dependencies.userId,
            }),
          ),
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
    const recollectedProviders = await Promise.all(
      expiredProviders.map(async ({ providerId }) => ({
        id: providerId,
        ...(await this.dependencies.repository.markProviderRunning(
          input.topicId,
          input.sessionId,
          providerId,
        )),
      })),
    );
    const providerAttempts = [...addedProviders, ...recollectedProviders].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    if (providerAttempts.length > 0) {
      await OnboardingUnderstandingWorkflow.triggerProviders(
        {
          providers: providerAttempts,
          sessionId: input.sessionId,
          topicId: input.topicId,
          userId: this.dependencies.userId,
        },
        {
          workflowRunId: `onboarding-understanding-extend-${input.sessionId}-${next.feedback?.revision ?? 0}-${providerAttempts.map(({ id, revision }) => `${id}-${revision}`).join('-')}`,
        },
      );
    }

    const sourceFingerprint = getUnderstandingSourceFingerprint(availableSession);
    if (input.feedback?.trim() && sourceFingerprint) {
      await OnboardingUnderstandingWorkflow.triggerWriting(
        {
          sessionId: input.sessionId,
          sourceFingerprint,
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
    const { OnboardingUnderstandingWorkflow } =
      await import('@/server/workflows/onboardingUnderstanding');
    OnboardingUnderstandingWorkflow.assertAvailable();
    const session = await this.activeSession(input.topicId, input.sessionId);
    const state = session.sources[input.providerId];
    if (!this.dependencies.providers.has(input.providerId) || !state) {
      throw new UnderstandingResourceNotFoundError('session');
    }
    if (state.status !== 'failed') {
      throw new UnderstandingPreconditionError('source_not_retryable');
    }
    const { revision } = await this.dependencies.repository.markProviderRunning(
      input.topicId,
      input.sessionId,
      input.providerId,
    );
    try {
      await OnboardingUnderstandingWorkflow.triggerProviders(
        {
          providers: [{ id: input.providerId, revision }],
          sessionId: input.sessionId,
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

  processProvider = async (input: ProviderOperationInput) => {
    const session = await this.activeSession(input.topicId, input.sessionId);
    const provider = this.dependencies.providers.get(input.providerId);
    const state = session.sources[input.providerId];
    if (!provider || !state) throw new UnderstandingResourceNotFoundError('session');
    const stale = () => ({
      failedCount: 0,
      providerId: input.providerId,
      revision: input.revision,
      sourceCount: 0,
      status: 'stale' as const,
      succeededCount: 0,
    });

    if (state.status === 'completed') {
      if (state.revision !== input.revision) return stale();
      const sourceFingerprint = getUnderstandingSourceFingerprint(session);
      if (!sourceFingerprint) throw new UnderstandingProviderContextUnavailableError();
      const stored = await this.dependencies.sourceStore().get({
        providerId: input.providerId,
        revision: input.revision,
        sessionId: input.sessionId,
        userId: this.dependencies.userId,
      });
      if (stored) {
        return {
          failedCount: stored.diagnostics.failedCount,
          providerId: input.providerId,
          revision: input.revision,
          sourceCount: stored.sourceCount,
          sourceFingerprint,
          status: 'completed' as const,
          succeededCount: stored.diagnostics.succeededCount,
        };
      }
      const expired = await this.dependencies.repository.expireProviderContexts({
        providers: [{ providerId: input.providerId, revision: input.revision }],
        sessionId: input.sessionId,
        sourceFingerprint,
        topicId: input.topicId,
      });
      const expiredState = expired.sources[input.providerId];
      return expiredState?.revision === input.revision && expiredState.status === 'failed'
        ? {
            failedCount: expiredState.failedCount,
            providerId: input.providerId,
            revision: input.revision,
            sourceCount: 0,
            status: 'failed' as const,
            succeededCount: expiredState.succeededCount,
          }
        : stale();
    }

    if (state.status === 'pending') {
      if (state.revision + 1 !== input.revision) return stale();
      const running = await this.dependencies.repository.markProviderRunning(
        input.topicId,
        input.sessionId,
        input.providerId,
      );
      if (running.revision !== input.revision) return stale();
    } else if (state.status !== 'running' || state.revision !== input.revision) {
      return stale();
    }

    let collected;
    try {
      collected = await provider.collect({
        connectorData: this.dependencies.connectorData,
        userId: this.dependencies.userId,
      });
    } catch (error) {
      if (!(error instanceof ConnectorDataError) || error.retryable) throw error;
      return this.recordProviderFailure(input, 0);
    }

    const context = collected.context.trim().slice(0, MAX_SOURCE_BRIEF_LENGTH);
    const diagnostics = sanitizeProviderDiagnostics(input.providerId, collected.diagnostics);
    const usable =
      Boolean(context) &&
      collected.sourceCount > 0 &&
      diagnostics.evidenceCount > 0 &&
      diagnostics.succeededCount > 0;
    if (!usable) return this.recordProviderFailure(input, diagnostics.succeededCount, diagnostics);

    const stored = {
      context,
      diagnostics,
      providerId: input.providerId,
      revision: input.revision,
      sessionId: input.sessionId,
      sourceCount: collected.sourceCount,
      userId: this.dependencies.userId,
    };
    await this.dependencies.sourceStore().put(stored);
    const transition = await this.dependencies.repository.completeProvider({
      errors: diagnostics.errors,
      failedCount: diagnostics.failedCount,
      providerId: input.providerId,
      revision: input.revision,
      sessionId: input.sessionId,
      succeededCount: diagnostics.succeededCount,
      topicId: input.topicId,
    });
    const sourceFingerprint = getUnderstandingSourceFingerprint(transition);
    if (!sourceFingerprint) throw new UnderstandingProviderContextUnavailableError();
    return {
      failedCount: diagnostics.failedCount,
      providerId: input.providerId,
      revision: input.revision,
      sourceCount: collected.sourceCount,
      sourceFingerprint,
      status: 'completed' as const,
      succeededCount: diagnostics.succeededCount,
    };
  };

  failProvider = async (input: ProviderOperationInput) => {
    try {
      return await this.dependencies.repository.failProvider({
        errors: [
          canonicalCollectionError(
            input.providerId,
            'collection',
            'UNDERSTANDING_PROVIDER_COLLECTION_FAILED',
            true,
          ),
        ],
        failedCount: 1,
        providerId: input.providerId,
        revision: input.revision,
        sessionId: input.sessionId,
        succeededCount: 0,
        topicId: input.topicId,
      });
    } catch (error) {
      if (
        error instanceof StaleUnderstandingRevisionError ||
        error instanceof StaleUnderstandingSessionError
      ) {
        return;
      }
      throw error;
    }
  };

  processCollected = async ({
    expectedSourceFingerprint,
    sessionId,
    topicId,
  }: ProcessCollectedInput) => {
    const session = await this.activeSession(topicId, sessionId);
    const feedback = session.feedback ?? { revision: 0, turns: [] };
    if (getUnderstandingSourceFingerprint(session) !== expectedSourceFingerprint) {
      return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
    }
    if (
      session.writing?.sourceFingerprint === expectedSourceFingerprint &&
      (session.writing.feedbackRevision ?? 0) === feedback.revision &&
      session.writing.status === 'completed'
    ) {
      return {
        published: true as const,
        resultId: session.writing.resultMessageId,
        sourceFingerprint: expectedSourceFingerprint,
      };
    }

    const completed = Object.entries(session.sources)
      .filter(([, state]) => state.status === 'completed')
      .sort(([left], [right]) => left.localeCompare(right));
    const sourceStore = this.dependencies.sourceStore();
    const contexts = await Promise.all(
      completed.map(([providerId, state]) =>
        sourceStore.get({
          providerId,
          revision: state.revision,
          sessionId,
          userId: this.dependencies.userId,
        }),
      ),
    );
    const missing = completed.flatMap(([providerId, state], index) =>
      contexts[index] ? [] : [{ providerId, revision: state.revision }],
    );
    if (missing.length > 0) {
      await this.dependencies.repository.expireProviderContexts({
        providers: missing,
        sessionId,
        sourceFingerprint: expectedSourceFingerprint,
        topicId,
      });
      return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
    }

    const sourceContexts = contexts as StoredUnderstandingProviderContext[];
    const threadId = writingThreadId(sessionId, expectedSourceFingerprint, feedback.revision);
    const writerAgent = await this.dependencies.writerAgent();
    const prepared = await this.dependencies.repository.prepareWriting({
      agentId: writerAgent.id,
      expectedFeedbackRevision: feedback.revision,
      sessionId,
      sourceFingerprint: expectedSourceFingerprint,
      threadId,
      topicId,
    });
    if (!prepared.ready) {
      return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
    }

    const providers = sourceContexts.map(({ providerId }) => providerId);
    const diagnostics = sumDiagnostics(session, sourceContexts);
    const writerResult = await this.runWriter({
      contexts: sourceContexts,
      diagnostics,
      feedback: feedback.turns,
      providers,
      threadId,
      topicId,
      writerAgent,
    });
    const metadata = OnboardingUnderstandingMessageMetadataSchema.parse({
      analysis: writerResult.analysis,
      diagnostics,
      feedbackRevision: prepared.feedbackRevision,
      generationRevision: prepared.generationRevision,
      kind: 'proposal',
      providers,
      resultId: writerResult.assistantMessageId,
      sourceFingerprint: expectedSourceFingerprint,
    });
    const committed = await this.dependencies.repository.commitWriting({
      assistantMessageId: writerResult.assistantMessageId,
      feedbackRevision: prepared.feedbackRevision,
      generationRevision: prepared.generationRevision,
      metadata,
      sessionId,
      sourceFingerprint: expectedSourceFingerprint,
      threadId,
      topicId,
    });
    if (!committed.published) {
      return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
    }
    return {
      ...(committed.personaVersion === undefined
        ? {}
        : { personaVersion: committed.personaVersion }),
      published: true as const,
      resultId: writerResult.assistantMessageId,
      sourceFingerprint: expectedSourceFingerprint,
    };
  };

  failWriting = async ({
    sessionId,
    sourceFingerprint,
    topicId,
  }: {
    sessionId: string;
    sourceFingerprint: string;
    topicId: string;
  }) => {
    try {
      const current = await this.activeSession(topicId, sessionId);
      if (!current.writing || current.writing.sourceFingerprint !== sourceFingerprint) return;
      const session = await this.dependencies.repository.failWriting({
        error: canonicalCollectionError(
          'understanding',
          'writing',
          'UNDERSTANDING_WRITING_FAILED',
          true,
        ),
        feedbackRevision: current.writing.feedbackRevision ?? 0,
        generationRevision: current.writing.generationRevision ?? 0,
        sessionId,
        sourceFingerprint,
        topicId,
      });
      return session.writing?.sourceFingerprint === sourceFingerprint &&
        session.writing.status === 'failed'
        ? session
        : undefined;
    } catch (error) {
      if (
        error instanceof StaleUnderstandingRevisionError ||
        error instanceof StaleUnderstandingSessionError
      ) {
        return;
      }
      throw error;
    }
  };

  confirm = (input: ConfirmOnboardingUnderstandingInput) =>
    this.dependencies.repository.confirm(input);

  private activeSession = async (topicId: string, sessionId: string) => {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const session = await this.dependencies.repository.get(topicId);
    if (!session) throw new UnderstandingSessionNotFoundError(topicId);
    if (session.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);
    return session;
  };

  private recordProviderFailure = async (
    input: ProviderOperationInput,
    succeededCount: number,
    diagnostics?: CollectionDiagnostics,
  ) => {
    const errors = diagnostics?.errors.length
      ? diagnostics.errors
      : [
          canonicalCollectionError(
            input.providerId,
            'collection',
            'UNDERSTANDING_PROVIDER_COLLECTION_FAILED',
            false,
          ),
        ];
    await this.dependencies.repository.failProvider({
      errors,
      failedCount: Math.max(1, diagnostics?.failedCount ?? 1),
      providerId: input.providerId,
      revision: input.revision,
      sessionId: input.sessionId,
      succeededCount,
      topicId: input.topicId,
    });
    return {
      failedCount: Math.max(1, diagnostics?.failedCount ?? 1),
      providerId: input.providerId,
      revision: input.revision,
      sourceCount: 0,
      status: 'failed' as const,
      succeededCount,
    };
  };

  private runWriter = async ({
    contexts,
    diagnostics,
    feedback,
    providers,
    threadId,
    topicId,
    writerAgent,
  }: {
    contexts: StoredUnderstandingProviderContext[];
    diagnostics: CollectionDiagnostics;
    feedback: UnderstandingFeedbackTurn[];
    providers: string[];
    threadId: string;
    topicId: string;
    writerAgent: { id: string; model: string; provider: string };
  }) => {
    const existing = await this.dependencies.messages.findLatestAssistantMessageByThread({
      agentId: writerAgent.id,
      threadId,
      topicId,
    });
    if (existing && !existing.error) {
      const analysis = parseStoredAnalysis(existing.content);
      if (analysis) return { analysis, assistantMessageId: existing.id };
    }

    const baseline = await this.dependencies.persona.getLatestPersonaDocument();
    const analysis = UnderstandingAnalysisSchema.parse(
      await this.dependencies.generator.generateObject(
        {
          messages: [
            {
              content: chainUnderstandingPersona({ diagnostics, feedback, providers }),
              role: 'system',
            },
            {
              content: [
                'Write onboarding persona from collected provider contexts.',
                buildEphemeralDocument(contexts, baseline),
              ].join('\n\n'),
              role: 'user',
            },
          ],
          model: writerAgent.model,
          provider: writerAgent.provider,
          schema: UNDERSTANDING_ANALYSIS_JSON_SCHEMA,
          thinking: { type: 'disabled' },
        },
        { metadata: { trigger: RequestTrigger.Onboarding } },
      ),
    );
    const message = await this.dependencies.messages.create({
      agentId: writerAgent.id,
      content: JSON.stringify(analysis),
      model: writerAgent.model,
      provider: writerAgent.provider,
      role: 'assistant',
      threadId,
      topicId,
    });
    return {
      analysis,
      assistantMessageId: message.id,
    };
  };
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
