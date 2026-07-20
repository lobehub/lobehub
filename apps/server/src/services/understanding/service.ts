import { createHash, randomUUID } from 'node:crypto';

import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import {
  getUnderstandingSourceFingerprint,
  OnboardingUnderstandingRepository,
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
  UnderstandingPreconditionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import { chainUnderstandingPersona } from '@lobechat/prompts/understanding';
import type {
  CollectionDiagnostics,
  ConfirmOnboardingUnderstandingInput,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingSession,
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
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';
import { AiAgentService } from '@/server/services/aiAgent';

import type { UnderstandingProviderRegistry } from './providers';
import {
  builtinUnderstandingProviderRegistrations,
  materializeUnderstandingProviders,
} from './providers';
import {
  boundCanonicalDiagnostics,
  canonicalCollectionError,
  MAX_AGENT_INPUT_LENGTH,
  sanitizeProviderDiagnostics,
} from './sanitizer';
import type { StoredUnderstandingProviderContext } from './sourceStore';
import { UnderstandingSourceStore } from './sourceStore';
import type { UnderstandingProviderRegistration } from './types';

const UNDERSTANDING_AGENT_SLUG = 'onboarding-understanding';
const BASELINE_MAX_LENGTH = 8_000;

interface ProviderOperationInput {
  providerId: string;
  revision: number;
  sessionId: string;
  topicId: string;
}

interface ProviderClaimInput {
  providerId: string;
  sessionId: string;
  topicId: string;
}

interface ProcessCollectedInput extends WritingClaimInput {
  expectedSourceFingerprint: string;
}

interface WritingClaimInput {
  sessionId: string;
  topicId: string;
}

interface WritingOperationInput extends WritingClaimInput {
  sourceFingerprint: string;
  threadId: string;
}

interface UnderstandingAgentInput {
  appContext: { threadId: string; topicId: string };
  autoStart: false;
  ephemeralUserMessage: string;
  instructions: string;
  maxSteps: 1;
  prompt: string;
  slug: string;
  suppressUserMessage: true;
  trigger: RequestTrigger;
}

interface UnderstandingWriterRuntime {
  agent: {
    execAgent: (input: UnderstandingAgentInput) => Promise<{
      assistantMessageId?: string;
      error?: string;
      operationId?: string;
      success: boolean;
    }>;
  };
  executeOperation: (operationId: string) => Promise<{ status: string }>;
}

type UnderstandingRepository = Pick<
  OnboardingUnderstandingRepository,
  | 'claimWriting'
  | 'commitWriting'
  | 'completeProvider'
  | 'confirm'
  | 'ensureWritingThread'
  | 'failProvider'
  | 'failWriting'
  | 'get'
  | 'initialize'
  | 'markProviderRunning'
>;

type UnderstandingContexts = Pick<UnderstandingSourceStore, 'get' | 'put'>;

export interface UnderstandingServiceDependencies {
  ids: () => string;
  messages: {
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
  providers: UnderstandingProviderRegistry;
  repository: UnderstandingRepository;
  sourceStore: () => Promise<UnderstandingContexts>;
  topic: {
    assertActiveOnboardingTopic: (topicId: string) => Promise<void>;
    findById: (topicId: string) => Promise<
      | {
          metadata?: {
            runningOperation?: {
              assistantMessageId: string;
              operationId: string;
              threadId?: string | null;
            } | null;
          } | null;
        }
      | null
      | undefined
    >;
  };
  userId: string;
  writerAgentId: () => Promise<string>;
  writerRuntime: () => Promise<UnderstandingWriterRuntime>;
}

export class UnderstandingProviderContextUnavailableError extends Error {
  constructor() {
    super('Current onboarding Understanding provider context is unavailable');
    this.name = 'UnderstandingProviderContextUnavailableError';
  }
}

const discardUnderstandingSnapshotStore: ISnapshotStore = {
  get: () => Promise.resolve(null),
  getLatest: () => Promise.resolve(null),
  list: () => Promise.resolve([]),
  listPartials: () => Promise.resolve([]),
  loadPartial: () => Promise.resolve(null),
  removePartial: () => Promise.resolve(),
  save: () => Promise.resolve(),
  savePartial: () => Promise.resolve(),
};

const parseAnalysis = (content: unknown) => {
  if (typeof content !== 'string') throw new TypeError('Understanding assistant output is missing');
  const trimmed = content.trim();
  if (!trimmed.startsWith('```')) return UnderstandingAnalysisSchema.parse(JSON.parse(trimmed));

  const firstNewline = trimmed.indexOf('\n');
  const closingFence = trimmed.lastIndexOf('```');
  if (firstNewline < 0 || closingFence <= firstNewline) {
    throw new SyntaxError('Understanding assistant output contains an invalid JSON fence');
  }
  return UnderstandingAnalysisSchema.parse(
    JSON.parse(trimmed.slice(firstNewline + 1, closingFence).trim()),
  );
};

const writingThreadId = (sessionId: string, sourceFingerprint: string) =>
  `thd_${createHash('sha256')
    .update(sessionId)
    .update('\0')
    .update(sourceFingerprint)
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
  const delimiters = contexts.map(({ providerId, revision }) => {
    return {
      close: '\n</provider-context>',
      open: `<provider-context provider="${providerId}" revision="${revision}">\n`,
    };
  });
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

  initialize = async (topicId: string): Promise<OnboardingUnderstandingSession> => {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const current = await this.dependencies.repository.get(topicId);
    if (current) return current;
    const providerIds = this.dependencies.providers
      .list()
      .map(({ id }) => id)
      .sort();
    return this.dependencies.repository.initialize(topicId, this.dependencies.ids(), providerIds);
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
      id: session.id,
      ...(proposal ? { proposal } : {}),
      sources: session.sources,
      status: projectOnboardingUnderstandingSessionStatus(session),
      ...(session.writing ? { writing: session.writing } : {}),
    };
  };

  claimProvider = async ({ providerId, sessionId, topicId }: ProviderClaimInput) => {
    const session = await this.activeSession(topicId, sessionId);
    if (!this.dependencies.providers.get(providerId) || !session.sources[providerId]) {
      throw new UnderstandingResourceNotFoundError('session');
    }
    const current = session.sources[providerId];
    if (current.status === 'completed' || current.status === 'running') {
      return { claimed: false, providerId, revision: current.revision };
    }
    const claim = await this.dependencies.repository.markProviderRunning(
      topicId,
      sessionId,
      providerId,
    );
    return { ...claim, providerId };
  };

  assertProviderRetryable = async ({ providerId, sessionId, topicId }: ProviderClaimInput) => {
    const session = await this.activeSession(topicId, sessionId);
    if (!this.dependencies.providers.get(providerId) || !session.sources[providerId]) {
      throw new UnderstandingResourceNotFoundError('session');
    }
    if (session.sources[providerId].status !== 'failed') {
      throw new UnderstandingPreconditionError('source_not_retryable');
    }
    return { providerId };
  };

  prepareProviderRetry = async ({ providerId, sessionId, topicId }: ProviderClaimInput) => {
    const session = await this.activeSession(topicId, sessionId);
    const provider = session.sources[providerId];
    if (!this.dependencies.providers.get(providerId) || !provider) {
      throw new UnderstandingResourceNotFoundError('session');
    }
    if (provider.status !== 'failed') {
      throw new UnderstandingPreconditionError('source_not_retryable');
    }

    const claim = await this.dependencies.repository.markProviderRunning(
      topicId,
      sessionId,
      providerId,
      { revision: provider.revision, status: 'failed' },
    );
    if (!claim.claimed) throw new StaleUnderstandingRevisionError(providerId, provider.revision);
    return { providerId, revision: claim.revision };
  };

  processProvider = async (input: ProviderClaimInput) => {
    const session = await this.activeSession(input.topicId, input.sessionId);
    const provider = this.dependencies.providers.get(input.providerId);
    const state = session.sources[input.providerId];
    if (!provider || !state) throw new UnderstandingResourceNotFoundError('session');

    if (state.status === 'failed') {
      return {
        failedCount: state.failedCount,
        providerId: input.providerId,
        revision: state.revision,
        sourceCount: 0,
        status: 'failed' as const,
        succeededCount: state.succeededCount,
      };
    }

    if (state.status === 'completed') {
      const sourceStore = await this.dependencies.sourceStore();
      const stored = await sourceStore.get({
        providerId: input.providerId,
        revision: state.revision,
        sessionId: input.sessionId,
        userId: this.dependencies.userId,
      });
      if (!stored) throw new UnderstandingProviderContextUnavailableError();
      const sourceFingerprint = getUnderstandingSourceFingerprint(session);
      if (!sourceFingerprint) throw new UnderstandingProviderContextUnavailableError();
      return {
        failedCount: stored.diagnostics.failedCount,
        providerId: input.providerId,
        revision: state.revision,
        sourceCount: stored.sourceCount,
        sourceFingerprint,
        status: 'completed' as const,
        succeededCount: stored.diagnostics.succeededCount,
      };
    }

    let revision = state.revision;
    if (state.status === 'pending') {
      const claim = await this.dependencies.repository.markProviderRunning(
        input.topicId,
        input.sessionId,
        input.providerId,
        { revision: state.revision, status: 'pending' },
      );
      if (!claim.claimed) return this.processProvider(input);
      revision = claim.revision;
    }

    const result = await this.collectProvider({ ...input, revision });
    if (result.status !== 'completed') return result;

    const completed = await this.activeSession(input.topicId, input.sessionId);
    const current = completed.sources[input.providerId];
    if (current?.status !== 'completed' || current.revision !== revision) {
      throw new StaleUnderstandingRevisionError(input.providerId, revision);
    }
    const sourceFingerprint = getUnderstandingSourceFingerprint(completed);
    if (!sourceFingerprint) throw new UnderstandingProviderContextUnavailableError();
    return {
      ...result,
      sourceFingerprint,
    };
  };

  collectProvider = async (input: ProviderOperationInput) => {
    const session = await this.activeSession(input.topicId, input.sessionId);
    const state = session.sources[input.providerId];
    const provider = this.dependencies.providers.get(input.providerId);
    if (!state || !provider) throw new UnderstandingResourceNotFoundError('session');
    if (state.revision !== input.revision || state.status !== 'running') {
      throw new StaleUnderstandingRevisionError(input.providerId, input.revision);
    }

    const collected = await provider.collect({ userId: this.dependencies.userId });
    const context = collected.context.trim();
    const diagnostics = sanitizeProviderDiagnostics(input.providerId, collected.diagnostics);
    const usable =
      Boolean(context) &&
      collected.sourceCount > 0 &&
      diagnostics.evidenceCount > 0 &&
      diagnostics.succeededCount > 0;
    if (!usable) {
      const errors =
        diagnostics.errors.length > 0
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
        failedCount: Math.max(1, diagnostics.failedCount),
        providerId: input.providerId,
        revision: input.revision,
        sessionId: input.sessionId,
        succeededCount: diagnostics.succeededCount,
        topicId: input.topicId,
      });
      return {
        failedCount: Math.max(1, diagnostics.failedCount),
        providerId: input.providerId,
        revision: input.revision,
        sourceCount: 0,
        status: 'failed' as const,
        succeededCount: diagnostics.succeededCount,
      };
    }

    const sourceStore = await this.dependencies.sourceStore();
    const collectedContext = {
      context,
      diagnostics,
      providerId: input.providerId,
      revision: input.revision,
      sessionId: input.sessionId,
      sourceCount: collected.sourceCount,
      userId: this.dependencies.userId,
    };
    const written = await sourceStore.put(collectedContext);
    const authoritative = written
      ? collectedContext
      : await sourceStore.get({
          providerId: input.providerId,
          revision: input.revision,
          sessionId: input.sessionId,
          userId: this.dependencies.userId,
        });
    if (!authoritative) throw new UnderstandingProviderContextUnavailableError();
    await this.dependencies.repository.completeProvider({
      errors: authoritative.diagnostics.errors,
      failedCount: authoritative.diagnostics.failedCount,
      providerId: input.providerId,
      revision: input.revision,
      sessionId: input.sessionId,
      succeededCount: authoritative.diagnostics.succeededCount,
      topicId: input.topicId,
    });
    return {
      failedCount: authoritative.diagnostics.failedCount,
      providerId: input.providerId,
      revision: input.revision,
      sourceCount: authoritative.sourceCount,
      status: 'completed' as const,
      succeededCount: authoritative.diagnostics.succeededCount,
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

  claimWriting = async ({ sessionId, topicId }: WritingClaimInput) => {
    const session = await this.activeSession(topicId, sessionId);
    const sourceFingerprint = getUnderstandingSourceFingerprint(session);
    if (!sourceFingerprint) throw new UnderstandingProviderContextUnavailableError();

    const threadId = writingThreadId(sessionId, sourceFingerprint);
    const claim = await this.dependencies.repository.claimWriting({
      sessionId,
      sourceFingerprint,
      topicId,
    });
    return { ...claim, sourceFingerprint, threadId };
  };

  processCollected = async ({
    expectedSourceFingerprint,
    sessionId,
    topicId,
  }: ProcessCollectedInput) => {
    const session = await this.activeSession(topicId, sessionId);
    if (getUnderstandingSourceFingerprint(session) !== expectedSourceFingerprint) {
      return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
    }

    const threadId = writingThreadId(sessionId, expectedSourceFingerprint);
    if (session.writing?.sourceFingerprint === expectedSourceFingerprint) {
      if (session.writing.status === 'completed') {
        return {
          published: true as const,
          resultId: session.writing.resultMessageId,
          sourceFingerprint: expectedSourceFingerprint,
        };
      }
      if (session.writing.status === 'failed') {
        return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
      }
    } else {
      try {
        await this.dependencies.repository.claimWriting({
          sessionId,
          sourceFingerprint: expectedSourceFingerprint,
          topicId,
        });
      } catch (error) {
        if (error instanceof StaleUnderstandingRevisionError) {
          return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
        }
        throw error;
      }
    }

    return this.writeCollected({
      sessionId,
      sourceFingerprint: expectedSourceFingerprint,
      threadId,
      topicId,
    });
  };

  writeCollected = async (input: WritingOperationInput) => {
    let session = await this.activeSession(input.topicId, input.sessionId);
    if (
      getUnderstandingSourceFingerprint(session) !== input.sourceFingerprint ||
      session.writing?.sourceFingerprint !== input.sourceFingerprint ||
      input.threadId !== writingThreadId(input.sessionId, input.sourceFingerprint)
    ) {
      return { published: false as const, sourceFingerprint: input.sourceFingerprint };
    }
    if (session.writing.status === 'completed') {
      return {
        published: true as const,
        resultId: session.writing.resultMessageId,
        sourceFingerprint: input.sourceFingerprint,
      };
    }
    if (session.writing.status !== 'running') {
      return { published: false as const, sourceFingerprint: input.sourceFingerprint };
    }

    const contexts = await this.loadCurrentContexts(session);
    session = await this.activeSession(input.topicId, input.sessionId);
    if (
      getUnderstandingSourceFingerprint(session) !== input.sourceFingerprint ||
      session.writing?.sourceFingerprint !== input.sourceFingerprint ||
      session.writing.status !== 'running'
    ) {
      return { published: false as const, sourceFingerprint: input.sourceFingerprint };
    }

    const writerAgentId = await this.dependencies.writerAgentId();
    await this.dependencies.repository.ensureWritingThread({
      agentId: writerAgentId,
      sessionId: input.sessionId,
      sourceFingerprint: input.sourceFingerprint,
      threadId: input.threadId,
      topicId: input.topicId,
    });

    const providers = contexts.map(({ providerId }) => providerId);
    const diagnostics = sumDiagnostics(session, contexts);
    const runningOperation = (await this.dependencies.topic.findById(input.topicId))?.metadata
      ?.runningOperation;
    const recovered = runningOperation?.threadId === input.threadId ? runningOperation : undefined;
    let assistantMessageId: string;
    let assistantContent: unknown;
    let recoveredAnalysis: ReturnType<typeof parseAnalysis> | undefined;
    if (recovered) {
      assistantMessageId = recovered.assistantMessageId;
      const runtime = await this.dependencies.writerRuntime();
      const operation = await runtime.executeOperation(recovered.operationId);
      if (operation.status !== 'done') {
        throw new Error('Onboarding Understanding persona writer did not complete');
      }
      assistantContent = (await this.dependencies.messages.findById(assistantMessageId))?.content;
    } else {
      const existingAssistant = await this.dependencies.messages.findLatestAssistantMessageByThread(
        {
          agentId: writerAgentId,
          threadId: input.threadId,
          topicId: input.topicId,
        },
      );
      if (existingAssistant) {
        assistantMessageId = existingAssistant.id;
        try {
          if (existingAssistant.error) throw new Error('Assistant message has an error');
          recoveredAnalysis = parseAnalysis(existingAssistant.content);
        } catch {
          throw new Error('Onboarding Understanding existing assistant output is invalid');
        }
      } else {
        const [runtime, baseline] = await Promise.all([
          this.dependencies.writerRuntime(),
          this.dependencies.persona.getLatestPersonaDocument(),
        ]);
        const launched = await runtime.agent.execAgent({
          appContext: { threadId: input.threadId, topicId: input.topicId },
          autoStart: false,
          ephemeralUserMessage: buildEphemeralDocument(contexts, baseline),
          instructions: chainUnderstandingPersona({ diagnostics, providers }),
          maxSteps: 1,
          prompt: 'Write onboarding persona from collected provider contexts.',
          slug: UNDERSTANDING_AGENT_SLUG,
          suppressUserMessage: true,
          trigger: RequestTrigger.Onboarding,
        });
        if (!launched.success || !launched.operationId || !launched.assistantMessageId) {
          throw new Error('Unable to start onboarding Understanding persona writer');
        }
        assistantMessageId = launched.assistantMessageId;
        const operation = await runtime.executeOperation(launched.operationId);
        if (operation.status !== 'done') {
          throw new Error('Onboarding Understanding persona writer did not complete');
        }
        assistantContent = (await this.dependencies.messages.findById(assistantMessageId))?.content;
      }
    }

    const metadata = OnboardingUnderstandingMessageMetadataSchema.parse({
      analysis: recoveredAnalysis ?? parseAnalysis(assistantContent),
      diagnostics,
      kind: 'proposal',
      providers,
      resultId: assistantMessageId,
      sourceFingerprint: input.sourceFingerprint,
    });
    const committed = await this.dependencies.repository.commitWriting({
      assistantMessageId,
      metadata,
      sessionId: input.sessionId,
      sourceFingerprint: input.sourceFingerprint,
      threadId: input.threadId,
      topicId: input.topicId,
    });
    if (!committed.published) {
      return { published: false as const, sourceFingerprint: input.sourceFingerprint };
    }
    return {
      ...(committed.personaVersion === undefined
        ? {}
        : { personaVersion: committed.personaVersion }),
      published: true as const,
      resultId: assistantMessageId,
      sourceFingerprint: input.sourceFingerprint,
    };
  };

  failWriting = async ({
    sessionId,
    sourceFingerprint,
    topicId,
  }: Omit<WritingOperationInput, 'threadId'>) => {
    try {
      const session = await this.dependencies.repository.failWriting({
        error: canonicalCollectionError(
          'understanding',
          'writing',
          'UNDERSTANDING_WRITING_FAILED',
          true,
        ),
        sessionId,
        sourceFingerprint,
        topicId,
      });
      if (
        session.writing?.sourceFingerprint !== sourceFingerprint ||
        session.writing.status !== 'failed'
      ) {
        return;
      }
      return session;
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

  private loadCurrentContexts = async (session: OnboardingUnderstandingSession) => {
    const completed = Object.entries(session.sources)
      .filter(([, state]) => state.status === 'completed')
      .sort(([left], [right]) => left.localeCompare(right));
    const sourceStore = await this.dependencies.sourceStore();
    const contexts = await Promise.all(
      completed.map(([providerId, state]) =>
        sourceStore.get({
          providerId,
          revision: state.revision,
          sessionId: session.id,
          userId: this.dependencies.userId,
        }),
      ),
    );
    if (contexts.some((context) => !context)) {
      throw new UnderstandingProviderContextUnavailableError();
    }
    return contexts as StoredUnderstandingProviderContext[];
  };
}

interface CreateUnderstandingServiceOptions {
  db: LobeChatDatabase;
  registrations?: readonly UnderstandingProviderRegistration[];
  userId: string;
  workspaceId?: string;
}

const createRecoverableLazy = <T>(load: () => Promise<T>) => {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
};

export const createUnderstandingService = async ({
  db,
  userId,
  workspaceId,
  registrations = builtinUnderstandingProviderRegistrations,
}: CreateUnderstandingServiceOptions): Promise<UnderstandingService> => {
  if (workspaceId) throw new Error('Onboarding Understanding is available only in personal scope');

  const { registry: providers } = materializeUnderstandingProviders(registrations, { db, userId });
  const repository = new OnboardingUnderstandingRepository(db, userId);
  const messageModel = new MessageModel(db, userId);
  const topicModel = new TopicModel(db, userId);
  const writerAgent = createRecoverableLazy(async () => {
    const agent = await new AgentModel(db, userId).getBuiltinAgent(
      BUILTIN_AGENT_SLUGS.onboardingUnderstanding,
    );
    if (!agent) throw new Error('Onboarding Understanding agent is unavailable');
    return agent;
  });
  const sourceStore = createRecoverableLazy(async () => new UnderstandingSourceStore());
  const writerRuntime = createRecoverableLazy(async (): Promise<UnderstandingWriterRuntime> => {
    const aiAgentService = new AiAgentService(db, userId);
    const agentRuntime = new AgentRuntimeService(db, userId, {
      queueService: null,
      snapshotStore: discardUnderstandingSnapshotStore,
    });
    return {
      agent: { execAgent: (input) => aiAgentService.execAgent(input) },
      executeOperation: async (operationId) => {
        const state = await agentRuntime.executeSync(operationId, { maxSteps: 1 });
        return { status: state.status };
      },
    };
  });

  return new UnderstandingService({
    ids: randomUUID,
    messages: {
      findById: (id) => messageModel.findById(id),
      findLatestAssistantMessageByThread: (input) =>
        messageModel.findLatestAssistantMessageByThread(input),
    },
    persona: new UserPersonaModel(db, userId),
    providers,
    repository,
    sourceStore,
    topic: {
      assertActiveOnboardingTopic: async (topicId) => {
        const topic = await topicModel.findById(topicId);
        const onboarding = topic?.metadata?.onboardingSession;
        if (!topic || !onboarding || onboarding.finishedAt) {
          throw new UnderstandingResourceNotFoundError('topic');
        }
      },
      findById: (topicId) => topicModel.findById(topicId),
    },
    userId,
    writerAgentId: async () => (await writerAgent()).id,
    writerRuntime,
  });
};
