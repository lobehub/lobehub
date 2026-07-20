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
  agentId: string;
  executeOperation: (operationId: string) => Promise<{ status: string }>;
}

type UnderstandingRepository = Pick<
  OnboardingUnderstandingRepository,
  | 'claimWriting'
  | 'commitWriting'
  | 'completeProvider'
  | 'confirm'
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
    delimiters.reduce(
      (total, delimiter) => total + delimiter.open.length + delimiter.close.length,
      0,
    );
  const availableContent = Math.max(0, MAX_AGENT_INPUT_LENGTH - structuralLength);
  const perProvider = contexts.length === 0 ? 0 : Math.floor(availableContent / contexts.length);
  const providerSections = contexts.map(
    ({ context }, index) =>
      `${delimiters[index].open}${context.slice(0, perProvider)}${delimiters[index].close}`,
  );
  return `${baselineSection}${providerSections.join('\n\n')}`.slice(0, MAX_AGENT_INPUT_LENGTH);
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
    await sourceStore.put({
      context,
      diagnostics,
      providerId: input.providerId,
      revision: input.revision,
      sessionId: input.sessionId,
      sourceCount: collected.sourceCount,
      userId: this.dependencies.userId,
    });
    await this.dependencies.repository.completeProvider({
      errors: diagnostics.errors,
      failedCount: diagnostics.failedCount,
      providerId: input.providerId,
      revision: input.revision,
      sessionId: input.sessionId,
      succeededCount: diagnostics.succeededCount,
      topicId: input.topicId,
    });
    return {
      failedCount: diagnostics.failedCount,
      providerId: input.providerId,
      revision: input.revision,
      sourceCount: collected.sourceCount,
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

  claimWriting = async ({ sessionId, topicId }: WritingClaimInput) => {
    const session = await this.activeSession(topicId, sessionId);
    const sourceFingerprint = getUnderstandingSourceFingerprint(session);
    if (!sourceFingerprint) throw new UnderstandingProviderContextUnavailableError();
    await this.loadCurrentContexts(session);

    const threadId = writingThreadId(sessionId, sourceFingerprint);
    const runtime = await this.dependencies.writerRuntime();
    const claim = await this.dependencies.repository.claimWriting({
      agentId: runtime.agentId,
      sessionId,
      sourceFingerprint,
      threadId,
      topicId,
    });
    return { ...claim, sourceFingerprint };
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

    const [runtime, baseline] = await Promise.all([
      this.dependencies.writerRuntime(),
      this.dependencies.persona.getLatestPersonaDocument(),
    ]);
    const providers = contexts.map(({ providerId }) => providerId);
    const diagnostics = sumDiagnostics(session, contexts);
    const runningOperation = (await this.dependencies.topic.findById(input.topicId))?.metadata
      ?.runningOperation;
    const recovered = runningOperation?.threadId === input.threadId ? runningOperation : undefined;
    let assistantMessageId: string;
    let operationId: string;
    if (recovered) {
      assistantMessageId = recovered.assistantMessageId;
      operationId = recovered.operationId;
    } else {
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
      operationId = launched.operationId;
    }
    const operation = await runtime.executeOperation(operationId);
    if (operation.status !== 'done') {
      throw new Error('Onboarding Understanding persona writer did not complete');
    }

    const assistant = await this.dependencies.messages.findById(assistantMessageId);
    const metadata = OnboardingUnderstandingMessageMetadataSchema.parse({
      analysis: parseAnalysis(assistant?.content),
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
      return await this.dependencies.repository.failWriting({
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
    } catch (error) {
      if (error instanceof StaleUnderstandingSessionError) return;
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
  const sourceStore = createRecoverableLazy(async () => new UnderstandingSourceStore());
  const writerRuntime = createRecoverableLazy(async (): Promise<UnderstandingWriterRuntime> => {
    const agent = await new AgentModel(db, userId).getBuiltinAgent(
      BUILTIN_AGENT_SLUGS.onboardingUnderstanding,
    );
    if (!agent) throw new Error('Onboarding Understanding agent is unavailable');
    const aiAgentService = new AiAgentService(db, userId);
    const agentRuntime = new AgentRuntimeService(db, userId, {
      queueService: null,
      snapshotStore: discardUnderstandingSnapshotStore,
    });
    return {
      agent: { execAgent: (input) => aiAgentService.execAgent(input) },
      agentId: agent.id,
      executeOperation: async (operationId) => {
        const state = await agentRuntime.executeSync(operationId, { maxSteps: 1 });
        return { status: state.status };
      },
    };
  });

  return new UnderstandingService({
    ids: randomUUID,
    messages: { findById: (id) => messageModel.findById(id) },
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
    writerRuntime,
  });
};
