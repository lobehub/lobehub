import { createHash } from 'node:crypto';

import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  getUnderstandingSourceFingerprint,
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
} from '@lobechat/database';
import { observeOnboardingUnderstandingOperation } from '@lobechat/observability-otel/modules/onboarding-understanding';
import {
  chainUnderstandingPersona,
  UNDERSTANDING_ANALYSIS_JSON_SCHEMA,
  UNDERSTANDING_ANALYSIS_PROMPT_VERSION,
} from '@lobechat/prompts';
import type {
  CollectionDiagnostics,
  OnboardingUnderstandingSession,
  UnderstandingFeedbackTurn,
} from '@lobechat/types';
import {
  MAX_COLLECTION_ERRORS,
  OnboardingUnderstandingMessageMetadataSchema,
  RequestTrigger,
  UnderstandingAnalysisSchema,
} from '@lobechat/types';
import pMap from 'p-map';

import type { StoredUnderstandingProviderContext } from '../sourceStore';
import { readActiveSession } from './session';
import type { ProcessCollectedInput, UnderstandingServiceDependencies } from './types';
import {
  boundProviderDiagnostics,
  buildEphemeralDocument,
  createCollectionError,
  PROVIDER_IO_CONCURRENCY,
} from './utils';

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
  return boundProviderDiagnostics({
    errors: terminalSources.flatMap(({ errors }) => errors).slice(-MAX_COLLECTION_ERRORS),
    evidenceCount: contexts.reduce(
      (total, { diagnostics }) => total + diagnostics.evidenceCount,
      0,
    ),
    failedCount: terminalSources.reduce((total, source) => total + source.failedCount, 0),
    succeededCount: terminalSources.reduce((total, source) => total + source.succeededCount, 0),
  });
};

export const processCollected = async (
  dependencies: UnderstandingServiceDependencies,
  { expectedSourceFingerprint, responseLanguage, sessionId, topicId }: ProcessCollectedInput,
) =>
  observeOnboardingUnderstandingOperation(
    { operation: 'writer.process', sessionId, topicId },
    async () => {
      const operationAttributes = { sessionId, topicId };
      const session = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'session.read' },
        () => readActiveSession(dependencies, topicId, sessionId),
      );
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
          feedbackRevision: session.writing.feedbackRevision ?? 0,
          generationRevision: session.writing.generationRevision ?? 0,
          published: true as const,
          resultId: session.writing.resultMessageId,
          sourceFingerprint: expectedSourceFingerprint,
        };
      }

      const completed = Object.entries(session.sources)
        .filter(([, state]) => state.status === 'completed')
        .sort(([left], [right]) => left.localeCompare(right));
      const sourceStore = dependencies.sourceStore();
      const contexts = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.read-contexts' },
        () =>
          pMap(
            completed,
            ([providerId, state]) =>
              sourceStore.get({
                providerId,
                revision: state.revision,
                sessionId,
                userId: dependencies.userId,
              }),
            { concurrency: PROVIDER_IO_CONCURRENCY },
          ),
      );
      const missing = completed.flatMap(([providerId, state], index) =>
        contexts[index] ? [] : [{ providerId, revision: state.revision }],
      );
      if (missing.length > 0) {
        await dependencies.repository.expireProviderContexts({
          providers: missing,
          sessionId,
          sourceFingerprint: expectedSourceFingerprint,
          topicId,
        });
        return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
      }

      const sourceContexts = contexts as StoredUnderstandingProviderContext[];
      const threadId = writingThreadId(sessionId, expectedSourceFingerprint, feedback.revision);
      const writerAgent = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.resolve-agent' },
        () => dependencies.writerAgent(),
      );
      const prepared = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.prepare' },
        () =>
          dependencies.repository.prepareWriting({
            agentId: writerAgent.id,
            expectedFeedbackRevision: feedback.revision,
            sessionId,
            sourceFingerprint: expectedSourceFingerprint,
            threadId,
            topicId,
          }),
      );
      if (!prepared.ready) {
        return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
      }

      const providers = sourceContexts.map(({ providerId }) => providerId);
      const diagnostics = sumDiagnostics(session, sourceContexts);
      const writerResult = await runWriter(dependencies, {
        contexts: sourceContexts,
        diagnostics,
        feedback: feedback.turns,
        providers,
        responseLanguage,
        sessionId,
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
      const committed = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.commit' },
        () =>
          dependencies.repository.commitWriting({
            assistantMessageId: writerResult.assistantMessageId,
            feedbackRevision: prepared.feedbackRevision,
            generationRevision: prepared.generationRevision,
            metadata,
            sessionId,
            sourceFingerprint: expectedSourceFingerprint,
            threadId,
            topicId,
          }),
      );
      if (!committed.published) {
        return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
      }
      return {
        feedbackRevision: prepared.feedbackRevision,
        generationRevision: prepared.generationRevision,
        ...(committed.personaVersion === undefined
          ? {}
          : { personaVersion: committed.personaVersion }),
        published: true as const,
        resultId: writerResult.assistantMessageId,
        sourceFingerprint: expectedSourceFingerprint,
      };
    },
  );

export const failWriting = async (
  dependencies: UnderstandingServiceDependencies,
  {
    sessionId,
    sourceFingerprint,
    topicId,
  }: {
    sessionId: string;
    sourceFingerprint: string;
    topicId: string;
  },
) => {
  try {
    const current = await readActiveSession(dependencies, topicId, sessionId);
    if (current.writing && current.writing.sourceFingerprint !== sourceFingerprint) return;
    const session = await dependencies.repository.failWriting({
      error: createCollectionError(
        'understanding',
        'writing',
        'UNDERSTANDING_WRITING_FAILED',
        true,
      ),
      feedbackRevision: current.writing?.feedbackRevision ?? current.feedback?.revision ?? 0,
      generationRevision: current.writing?.generationRevision ?? current.generationRevision ?? 0,
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

const runWriter = async (
  dependencies: UnderstandingServiceDependencies,
  {
    contexts,
    diagnostics,
    feedback,
    providers,
    responseLanguage,
    sessionId,
    threadId,
    topicId,
    writerAgent,
  }: {
    contexts: StoredUnderstandingProviderContext[];
    diagnostics: CollectionDiagnostics;
    feedback: UnderstandingFeedbackTurn[];
    providers: string[];
    responseLanguage: string;
    sessionId: string;
    threadId: string;
    topicId: string;
    writerAgent: { id: string; model: string; provider: string };
  },
) =>
  observeOnboardingUnderstandingOperation(
    { operation: 'writer.generate', sessionId, topicId },
    async () => {
      const operationAttributes = { sessionId, topicId };
      const existing = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.read-existing' },
        () =>
          dependencies.messages.findLatestAssistantMessageByThread({
            agentId: writerAgent.id,
            threadId,
            topicId,
          }),
      );
      if (existing && !existing.error) {
        const analysis = parseStoredAnalysis(existing.content);
        if (analysis) return { analysis, assistantMessageId: existing.id };
      }

      const baseline = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.read-baseline' },
        () => dependencies.persona.getLatestPersonaDocument(),
      );
      const analysis = UnderstandingAnalysisSchema.parse(
        await observeOnboardingUnderstandingOperation(
          { ...operationAttributes, operation: 'generation.runtime-call' },
          () =>
            dependencies.generator.generateObject(
              {
                ...chainUnderstandingPersona({
                  context: buildEphemeralDocument(contexts, baseline),
                  diagnostics,
                  feedback,
                  providers,
                  responseLanguage,
                }),
                model: writerAgent.model,
                provider: writerAgent.provider,
                schema: UNDERSTANDING_ANALYSIS_JSON_SCHEMA,
                thinking: { type: 'disabled' },
              },
              {
                metadata: { trigger: RequestTrigger.Onboarding },
                tracing: {
                  promptVersion: UNDERSTANDING_ANALYSIS_PROMPT_VERSION,
                  scenario: TRACING_SCENARIOS.UnderstandingAnalysis,
                  schemaName: UNDERSTANDING_ANALYSIS_JSON_SCHEMA.name,
                },
              },
            ),
        ),
      );
      const message = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.create-message' },
        () =>
          dependencies.messages.create({
            agentId: writerAgent.id,
            content: JSON.stringify(analysis),
            model: writerAgent.model,
            provider: writerAgent.provider,
            role: 'assistant',
            threadId,
            topicId,
          }),
      );
      return {
        analysis,
        assistantMessageId: message.id,
      };
    },
  );
