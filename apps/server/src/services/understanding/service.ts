import { randomUUID } from 'node:crypto';

import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import {
  StaleUnderstandingRunError,
  StaleUnderstandingSessionError,
  UnderstandingConfirmationRepository,
  UnderstandingPreconditionError,
  UnderstandingResourceNotFoundError,
  UnderstandingResultRepository,
  UnderstandingSessionNotFoundError,
  UnderstandingSessionRepository,
} from '@lobechat/database';
import { chainUnderstandingMerge, chainUnderstandingSource } from '@lobechat/prompts/understanding';
import type {
  CollectionDiagnostics,
  CollectionError,
  ConfirmOnboardingUnderstandingInput,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
  UnderstandingMergedResult,
  UnderstandingMergeRunResult,
  UnderstandingSourceRef,
  UnderstandingSourceResult,
  UnderstandingSourceRunResult,
} from '@lobechat/types';
import {
  CollectionDiagnosticsSummarySchema,
  MAX_COLLECTION_COUNT,
  RequestTrigger,
  UnderstandingAnalysisSchema,
} from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';
import { AiAgentService } from '@/server/services/aiAgent';

import { discoverUnderstandingSources } from './pipeline';
import type { UnderstandingProviderRegistry } from './providers';
import {
  builtinUnderstandingProviderRegistrations,
  materializeUnderstandingProviders,
  toPublicUnderstandingSourceRef,
} from './providers';
import {
  boundCanonicalDiagnostics,
  canonicalCollectionError,
  MAX_AGENT_INPUT_LENGTH,
  MAX_SOURCE_BRIEF_LENGTH,
  sanitizeProviderDiagnostics,
} from './sanitizer';
import { UnderstandingSourceStore } from './sourceStore';
import type {
  ResolvedUnderstandingSource,
  SourceCandidate,
  UnderstandingProviderContext,
  UnderstandingProviderRegistration,
} from './types';

const UNDERSTANDING_AGENT_SLUG = 'onboarding-understanding';
const terminalStatuses = new Set(['completed', 'failed']);

export class UnderstandingBranchFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnderstandingBranchFailureError';
  }
}

// Privacy boundary: source briefs can contain raw connector data and must never reach file/S3
// Agent Runtime snapshots. The operation state remains durable in the runtime coordinator.
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

const emptyDiagnostics = (error?: CollectionError): CollectionDiagnostics => ({
  errors: error ? [error] : [],
  evidenceCount: 0,
  failedCount: error ? 1 : 0,
  succeededCount: 0,
});

const combineDiagnostics = (items: CollectionDiagnostics[]): CollectionDiagnostics =>
  boundCanonicalDiagnostics(
    items.reduce<CollectionDiagnostics>(
      (combined, item) => ({
        errors: [...combined.errors, ...item.errors],
        evidenceCount: combined.evidenceCount + item.evidenceCount,
        failedCount: combined.failedCount + item.failedCount,
        succeededCount: combined.succeededCount + item.succeededCount,
      }),
      emptyDiagnostics(),
    ),
  );

const parseAnalysis = (content: unknown): UnderstandingAnalysis => {
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

const reconcileMergedPronoun = (
  merged: UnderstandingAnalysis,
  sources: UnderstandingAnalysis[],
): UnderstandingAnalysis => {
  const explicit = new Map<string, string>();
  for (const source of sources) {
    const pronoun = source.profile.pronoun.trim();
    if (pronoun.toLowerCase() !== 'non-specific') explicit.set(pronoun.toLowerCase(), pronoun);
  }
  const pronoun = explicit.size === 1 ? explicit.values().next().value! : 'non-specific';
  return merged.profile.pronoun === pronoun
    ? merged
    : { ...merged, profile: { ...merged.profile, pronoun } };
};

interface SourceIdentity {
  sessionId: string;
  sourceId: string;
  threadId: string;
  topicId: string;
}

interface MergeIdentity {
  sessionId: string;
  threadId: string;
  topicId: string;
}

type UnderstandingConfirmationStore = Pick<UnderstandingConfirmationRepository, 'confirm'>;
type UnderstandingResults = Pick<
  UnderstandingResultRepository,
  'ensureThread' | 'finalizeMerge' | 'finalizeSource' | 'readMerge' | 'readSource'
>;
type UnderstandingSessions = Pick<
  UnderstandingSessionRepository,
  'attachWorkflowRun' | 'get' | 'install' | 'setMergeRun' | 'update' | 'updateSourceRun'
>;
type UnderstandingSources = Pick<
  UnderstandingSourceStore,
  'deleteSourcePayload' | 'get' | 'getSourceLocator' | 'put' | 'putSourceLocator'
>;

interface UnderstandingWorkflowRuntime {
  agent: Pick<AiAgentService, 'execAgent'>;
  agentId: string;
  agentRuntime: {
    executeOperation: (operationId: string) => Promise<{ status: string }>;
  };
  context: UnderstandingProviderContext;
  registry: UnderstandingProviderRegistry;
  sourceStore: UnderstandingSources;
}

interface UnderstandingServiceDependencies {
  confirmation: UnderstandingConfirmationStore;
  ids: () => string;
  messages: { readContent: (assistantMessageId: string) => Promise<unknown> };
  results: UnderstandingResults;
  sessions: UnderstandingSessions;
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
      | undefined
    >;
  };
  workflowRuntime: () => Promise<UnderstandingWorkflowRuntime>;
}

export interface UnderstandingLaunchReference {
  assistantMessageId: string;
  operationId: string;
  success: boolean;
  threadId: string;
}

export interface UnderstandingSourceLaunchReference extends UnderstandingLaunchReference {
  sourceId: string;
}

export interface UnderstandingSourceLaunchSkipped {
  skipped: true;
  sourceId: string;
  threadId: string;
}

export interface UnderstandingMergeLaunchFailed {
  failed: true;
  threadId: string;
}

export class UnderstandingService {
  constructor(private readonly dependencies: UnderstandingServiceDependencies) {}

  initialize = async (topicId: string): Promise<OnboardingUnderstandingSession> => {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const current = await this.dependencies.sessions.get(topicId);
    if (current) return current;
    return this.dependencies.sessions.install(topicId, {
      id: this.dependencies.ids(),
      runs: [],
      status: 'pending',
    });
  };

  attachWorkflowRun = (topicId: string, sessionId: string, workflowRunId: string) =>
    this.dependencies.sessions.attachWorkflowRun(topicId, sessionId, workflowRunId);

  discover = async (topicId: string, sessionId: string) => {
    const current = await this.activeSession(topicId, sessionId);
    if (current.runs.length > 0 || current.errors) return this.branches(current);
    const runtime = await this.dependencies.workflowRuntime();

    const discovery = await discoverUnderstandingSources(runtime.registry, runtime.context);
    for (const source of discovery.sources) {
      await runtime.sourceStore.putSourceLocator({
        locator: this.locator(source),
        sessionId,
        sourceId: source.id,
        userId: runtime.context.userId,
      });
    }
    const noSourceError =
      discovery.sources.length === 0
        ? canonicalCollectionError(
            'understanding',
            'source discovery',
            'UNDERSTANDING_NO_SOURCE_AVAILABLE',
            false,
          )
        : undefined;
    const errors = boundCanonicalDiagnostics({
      ...emptyDiagnostics(),
      errors: [...discovery.errors, ...(noSourceError ? [noSourceError] : [])],
      failedCount: discovery.errors.length + Number(Boolean(noSourceError)),
    }).errors;
    const candidateRuns = discovery.sources.map((source) => ({
      source: toPublicUnderstandingSourceRef(source),
      status: 'pending' as const,
      threadId: this.dependencies.ids(),
    }));
    const installed = await this.dependencies.sessions.update(topicId, sessionId, (session) =>
      session.runs.length > 0
        ? session
        : { ...session, errors, runs: candidateRuns, status: 'pending' },
    );
    return this.branches(installed);
  };

  getSourceBranches = async (topicId: string, sessionId: string) =>
    this.branches(await this.activeSession(topicId, sessionId));

  collectSource = async (input: SourceIdentity) => {
    const run = await this.sourceRun(input);
    const runtime = await this.dependencies.workflowRuntime();
    const provider = runtime.registry.get(run.source.provider);
    if (!provider) throw new Error('Understanding source provider is unavailable');
    let locator = await runtime.sourceStore.getSourceLocator({
      sessionId: input.sessionId,
      sourceId: input.sourceId,
      userId: runtime.context.userId,
    });
    let source = locator
      ? await provider.resolveSource(run.source, locator, runtime.context)
      : null;
    if (!source) {
      const recovered = await this.recoverSource(run.source, runtime);
      locator = this.locator(recovered);
      source = recovered;
      await runtime.sourceStore.putSourceLocator({
        locator,
        sessionId: input.sessionId,
        sourceId: input.sourceId,
        userId: runtime.context.userId,
      });
    }
    let collected;
    try {
      collected = await provider.collect(source, runtime.context);
    } catch (cause) {
      throw new UnderstandingBranchFailureError('Understanding source collection failed', {
        cause,
      });
    }
    const diagnostics = sanitizeProviderDiagnostics(run.source.provider, collected.diagnostics);
    const brief = collected.sourceBrief.trim().slice(0, MAX_SOURCE_BRIEF_LENGTH);
    if (!brief) {
      throw new UnderstandingBranchFailureError(
        'Understanding source collection returned no content',
      );
    }
    if (diagnostics.succeededCount === 0) {
      throw new UnderstandingBranchFailureError(
        'Understanding source collection produced no successful evidence',
      );
    }
    await runtime.sourceStore.put({
      ...input,
      brief,
      diagnostics,
      userId: runtime.context.userId,
    });
    await this.dependencies.sessions.updateSourceRun(
      input.topicId,
      input.sessionId,
      input.sourceId,
      input.threadId,
      { diagnostics: CollectionDiagnosticsSummarySchema.parse(diagnostics) },
    );
    return {
      diagnostics: CollectionDiagnosticsSummarySchema.parse(diagnostics),
      sourceCount: Math.min(MAX_COLLECTION_COUNT, Math.max(0, Math.floor(collected.sourceCount))),
    };
  };

  launchSourceAnalysis = async (
    input: SourceIdentity,
  ): Promise<UnderstandingSourceLaunchReference | UnderstandingSourceLaunchSkipped> => {
    const run = await this.sourceRun(input);
    const recovered = await this.recoverRunningOperation(input.topicId, input.threadId);
    if (recovered) {
      if (run.assistantMessageId && run.assistantMessageId !== recovered.assistantMessageId) {
        throw new Error('Understanding source launch does not match its active run');
      }
      if (!run.assistantMessageId) {
        await this.dependencies.sessions.updateSourceRun(
          input.topicId,
          input.sessionId,
          input.sourceId,
          input.threadId,
          { assistantMessageId: recovered.assistantMessageId, status: 'running' },
        );
      }
      return {
        assistantMessageId: recovered.assistantMessageId,
        operationId: recovered.operationId,
        sourceId: input.sourceId,
        success: true,
        threadId: input.threadId,
      };
    }
    if (run.assistantMessageId) {
      return { skipped: true, sourceId: input.sourceId, threadId: input.threadId };
    }
    const runtime = await this.dependencies.workflowRuntime();
    const payload = await runtime.sourceStore.get({
      ...input,
      userId: runtime.context.userId,
    });
    if (!payload) {
      throw new UnderstandingBranchFailureError('Understanding source payload is unavailable');
    }
    await this.dependencies.results.ensureThread({
      agentId: runtime.agentId,
      kind: 'source',
      threadId: input.threadId,
      topicId: input.topicId,
    });
    const launched = await runtime.agent.execAgent({
      appContext: { threadId: input.threadId, topicId: input.topicId },
      autoStart: false,
      ephemeralUserMessage: payload.brief.slice(0, MAX_AGENT_INPUT_LENGTH),
      instructions: chainUnderstandingSource({
        diagnostics: payload.diagnostics,
        provider: run.source.provider,
        sourceDisplayName: run.source.displayName,
      }),
      maxSteps: 1,
      prompt: 'Analyze onboarding understanding source.',
      slug: UNDERSTANDING_AGENT_SLUG,
      suppressUserMessage: true,
      trigger: RequestTrigger.Onboarding,
    });
    if (!launched.success) {
      throw new UnderstandingBranchFailureError(
        launched.error ?? 'Understanding agent launch failed',
      );
    }
    await this.dependencies.sessions.updateSourceRun(
      input.topicId,
      input.sessionId,
      input.sourceId,
      input.threadId,
      { assistantMessageId: launched.assistantMessageId, status: 'running' },
    );
    return {
      assistantMessageId: launched.assistantMessageId,
      operationId: launched.operationId,
      sourceId: input.sourceId,
      success: true,
      threadId: input.threadId,
    };
  };

  executeAgentOperation = async (operationId: string) => {
    const runtime = await this.dependencies.workflowRuntime();
    const { status } = await runtime.agentRuntime.executeOperation(operationId);
    if (status === 'done') return { status: 'done' as const };
    if (status === 'error' || status === 'interrupted') return { status: 'error' as const };
    if (status === 'waiting_for_human' || status === 'waiting_for_async_tool') {
      return { status: 'parked' as const };
    }
    throw new Error(`Understanding agent operation did not settle: ${status}`);
  };

  finalizeSource = async (input: SourceIdentity & { assistantMessageId: string }) => {
    const run = await this.sourceRun(input);
    const runtime = await this.dependencies.workflowRuntime();
    const persisted = await this.readTerminalSource(input, run, runtime);
    if (persisted) return persisted;
    const payload = await runtime.sourceStore.get({
      ...input,
      userId: runtime.context.userId,
    });
    const diagnostics = payload?.diagnostics ?? emptyDiagnostics();
    let metadata: UnderstandingSourceResult;
    const content = await this.dependencies.messages.readContent(input.assistantMessageId);
    try {
      const analysis = parseAnalysis(content);
      metadata = {
        analysis,
        diagnostics,
        kind: 'source',
        resultId: input.assistantMessageId,
        source: run.source,
      };
    } catch {
      metadata = {
        diagnostics: combineDiagnostics([
          diagnostics,
          emptyDiagnostics(
            canonicalCollectionError(
              run.source.provider,
              'source analysis',
              'UNDERSTANDING_SOURCE_ANALYSIS_FAILED',
              true,
            ),
          ),
        ]),
        kind: 'source_error',
        resultId: input.assistantMessageId,
        source: run.source,
      };
    }
    const result = await this.dependencies.results.finalizeSource({
      ...input,
      agentId: runtime.agentId,
      metadata,
    });
    await runtime.sourceStore.deleteSourcePayload({
      ...input,
      userId: runtime.context.userId,
    });
    return result;
  };

  failSource = async (
    input: SourceIdentity & { assistantMessageId?: string; retryable?: boolean },
  ) => {
    const run = await this.sourceRun(input);
    const runtime = await this.dependencies.workflowRuntime();
    const persisted = await this.readTerminalSource(input, run, runtime);
    if (persisted) return persisted;
    const assistantMessageId = input.assistantMessageId ?? this.dependencies.ids();
    const payload = await runtime.sourceStore.get({
      ...input,
      userId: runtime.context.userId,
    });
    const diagnostics = combineDiagnostics([
      payload?.diagnostics ?? emptyDiagnostics(),
      emptyDiagnostics(
        canonicalCollectionError(
          run.source.provider,
          'source processing',
          'UNDERSTANDING_SOURCE_PROCESSING_FAILED',
          input.retryable ?? true,
        ),
      ),
    ]);
    await this.dependencies.results.ensureThread({
      agentId: runtime.agentId,
      kind: 'source',
      threadId: input.threadId,
      topicId: input.topicId,
    });
    const result = await this.dependencies.results.finalizeSource({
      ...input,
      agentId: runtime.agentId,
      assistantMessageId,
      metadata: {
        diagnostics,
        kind: 'source_error',
        resultId: assistantMessageId,
        source: run.source,
      },
    });
    await runtime.sourceStore.deleteSourcePayload({
      ...input,
      userId: runtime.context.userId,
    });
    return result;
  };

  launchMerge = async (
    topicId: string,
    sessionId: string,
    workflowRunId: string,
    requestedThreadId = this.dependencies.ids(),
  ): Promise<
    | (UnderstandingLaunchReference & { skipped?: false })
    | UnderstandingMergeLaunchFailed
    | { skipped: true; threadId: string }
  > => {
    const current = await this.activeSession(topicId, sessionId);
    if (current.runs.some((run) => !terminalStatuses.has(run.status))) {
      throw new UnderstandingPreconditionError('result_not_confirmable');
    }
    if (!current.runs.some((run) => run.status === 'completed')) {
      throw new UnderstandingPreconditionError('result_not_confirmable');
    }
    const session = await this.dependencies.sessions.setMergeRun(
      topicId,
      sessionId,
      workflowRunId,
      { status: 'pending', threadId: requestedThreadId },
    );
    const merge = session.mergeRun!;
    if (terminalStatuses.has(merge.status)) {
      return { skipped: true, threadId: merge.threadId };
    }
    const recovered = await this.recoverRunningOperation(topicId, merge.threadId);
    if (recovered) {
      if (merge.assistantMessageId && merge.assistantMessageId !== recovered.assistantMessageId) {
        throw new Error('Understanding merge launch does not match its active run');
      }
      if (!merge.assistantMessageId) {
        await this.dependencies.sessions.update(topicId, sessionId, (current) => {
          const currentMerge = current.mergeRun;
          if (currentMerge?.threadId !== merge.threadId) {
            throw new StaleUnderstandingRunError('merge', merge.threadId);
          }
          return {
            ...current,
            mergeRun: {
              ...currentMerge,
              assistantMessageId: recovered.assistantMessageId,
              status: 'running' as const,
            },
          };
        });
      }
      return {
        assistantMessageId: recovered.assistantMessageId,
        operationId: recovered.operationId,
        success: true,
        threadId: merge.threadId,
      };
    }
    if (merge.assistantMessageId) return { skipped: true, threadId: merge.threadId };
    const runtime = await this.dependencies.workflowRuntime();

    const materials = await this.completedMaterials(topicId, sessionId, session);
    const diagnostics = combineDiagnostics(materials.map(({ result }) => result.diagnostics));
    const analyses = materials.flatMap(({ result }) =>
      result.kind === 'source' ? [result.analysis] : [],
    );
    await this.dependencies.results.ensureThread({
      agentId: runtime.agentId,
      kind: 'merged',
      threadId: merge.threadId,
      topicId,
    });
    const launched = await runtime.agent.execAgent({
      appContext: { threadId: merge.threadId, topicId },
      autoStart: false,
      ephemeralUserMessage: JSON.stringify(analyses).slice(0, MAX_AGENT_INPUT_LENGTH),
      instructions: chainUnderstandingMerge({ diagnostics }),
      maxSteps: 1,
      prompt: 'Merge onboarding understanding sources.',
      slug: UNDERSTANDING_AGENT_SLUG,
      suppressUserMessage: true,
      trigger: RequestTrigger.Onboarding,
    });
    if (!launched.success) {
      return { failed: true, threadId: merge.threadId };
    }
    await this.dependencies.sessions.update(topicId, sessionId, (current) => {
      const currentMerge = current.mergeRun;
      if (currentMerge?.threadId !== merge.threadId) {
        throw new StaleUnderstandingRunError('merge', merge.threadId);
      }
      return {
        ...current,
        mergeRun: {
          ...currentMerge,
          assistantMessageId: launched.assistantMessageId,
          diagnostics: CollectionDiagnosticsSummarySchema.parse(diagnostics),
          status: 'running' as const,
        },
      };
    });
    return {
      assistantMessageId: launched.assistantMessageId,
      operationId: launched.operationId,
      success: true,
      threadId: merge.threadId,
    };
  };

  finalizeMerge = async (input: MergeIdentity & { assistantMessageId: string }) => {
    const session = await this.activeSession(input.topicId, input.sessionId);
    if (session.mergeRun?.threadId !== input.threadId) {
      throw new StaleUnderstandingRunError('merge', input.threadId);
    }
    const persisted = await this.readTerminalMerge(input, session);
    if (persisted) return persisted;
    const runtime = await this.dependencies.workflowRuntime();
    const materials = await this.completedMaterials(input.topicId, input.sessionId, session);
    const diagnostics = combineDiagnostics(materials.map(({ result }) => result.diagnostics));
    const sources = materials.flatMap(({ result }) =>
      result.kind === 'source' ? [result.analysis] : [],
    );
    let metadata: UnderstandingMergedResult;
    const content = await this.dependencies.messages.readContent(input.assistantMessageId);
    try {
      const analysis = reconcileMergedPronoun(parseAnalysis(content), sources);
      metadata = {
        analysis,
        diagnostics,
        inputThreadIds: materials.map(({ threadId }) => threadId),
        kind: 'merged',
        resultId: input.assistantMessageId,
      };
    } catch {
      metadata = this.mergeFailureMetadata(input.assistantMessageId, diagnostics, materials);
    }
    return this.dependencies.results.finalizeMerge({
      ...input,
      agentId: runtime.agentId,
      metadata,
    });
  };

  failMerge = async (input: MergeIdentity & { assistantMessageId?: string }) => {
    const session = await this.activeSession(input.topicId, input.sessionId);
    if (session.mergeRun?.threadId !== input.threadId) {
      throw new StaleUnderstandingRunError('merge', input.threadId);
    }
    const persisted = await this.readTerminalMerge(input, session);
    if (persisted) return persisted;
    const runtime = await this.dependencies.workflowRuntime();
    const assistantMessageId = input.assistantMessageId ?? this.dependencies.ids();
    const materials = await this.completedMaterials(input.topicId, input.sessionId, session);
    const diagnostics = combineDiagnostics(materials.map(({ result }) => result.diagnostics));
    await this.dependencies.results.ensureThread({
      agentId: runtime.agentId,
      kind: 'merged',
      threadId: input.threadId,
      topicId: input.topicId,
    });
    return this.dependencies.results.finalizeMerge({
      ...input,
      agentId: runtime.agentId,
      assistantMessageId,
      metadata: this.mergeFailureMetadata(assistantMessageId, diagnostics, materials),
    });
  };

  get = async (topicId: string): Promise<OnboardingUnderstandingPollingResult> => {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const session = await this.dependencies.sessions.get(topicId);
    if (!session) throw new UnderstandingSessionNotFoundError(topicId);
    const warnings: CollectionError[] = [];
    const runs: UnderstandingSourceRunResult[] = await Promise.all(
      session.runs.map(async (run) => {
        if (!run.assistantMessageId || !terminalStatuses.has(run.status)) return run;
        try {
          const result = await this.dependencies.results.readSource({
            assistantMessageId: run.assistantMessageId,
            sessionId: session.id,
            sourceId: run.source.id,
            threadId: run.threadId,
            topicId,
          });
          return { ...run, ...(result ? { result } : {}) };
        } catch {
          warnings.push(
            canonicalCollectionError(
              run.source.provider,
              'result read',
              'UNDERSTANDING_RESULT_READ_FAILED',
              true,
            ),
          );
          return run;
        }
      }),
    );
    let mergeRun: UnderstandingMergeRunResult | undefined;
    if (session.mergeRun) {
      mergeRun = session.mergeRun;
      if (session.mergeRun.assistantMessageId && terminalStatuses.has(session.mergeRun.status)) {
        try {
          const result = await this.dependencies.results.readMerge({
            assistantMessageId: session.mergeRun.assistantMessageId,
            sessionId: session.id,
            threadId: session.mergeRun.threadId,
            topicId,
          });
          if (result) mergeRun = { ...session.mergeRun, result };
        } catch {
          warnings.push(
            canonicalCollectionError(
              'merge',
              'result read',
              'UNDERSTANDING_RESULT_READ_FAILED',
              true,
            ),
          );
        }
      }
    }
    const merged = mergeRun?.result;
    const provisional = runs.find(({ result }) => result?.kind === 'source')?.result;
    const errors = boundCanonicalDiagnostics({
      ...emptyDiagnostics(),
      errors: [
        ...(session.errors ?? []),
        ...runs.flatMap(({ result }) => result?.diagnostics.errors ?? []),
        ...(mergeRun?.result?.diagnostics.errors ?? []),
      ],
    }).errors;
    return {
      ...(merged?.kind === 'merged'
        ? { displayResult: { kind: 'merged' as const, result: merged } }
        : provisional?.kind === 'source'
          ? { displayResult: { kind: 'provisional' as const, result: provisional } }
          : {}),
      ...(errors.length > 0 ? { errors } : {}),
      id: session.id,
      ...(mergeRun ? { mergeRun } : {}),
      runs,
      status: session.status,
      ...(warnings.length > 0
        ? {
            warnings: boundCanonicalDiagnostics({ ...emptyDiagnostics(), errors: warnings }).errors,
          }
        : {}),
    };
  };

  assertRetryable = async (input: Omit<SourceIdentity, 'threadId'>): Promise<string> => {
    const session = await this.activeSession(input.topicId, input.sessionId);
    const target = session.runs.find(({ source }) => source.id === input.sourceId);
    if (!target) throw new UnderstandingResourceNotFoundError('session');
    if (target.status !== 'failed') {
      throw new UnderstandingPreconditionError('source_not_retryable');
    }
    return target.threadId;
  };

  prepareRetry = async (input: Omit<SourceIdentity, 'threadId'>) => {
    const threadId = this.dependencies.ids();
    await this.dependencies.sessions.update(input.topicId, input.sessionId, (session) => {
      const target = session.runs.find(({ source }) => source.id === input.sourceId);
      if (!target) throw new UnderstandingResourceNotFoundError('session');
      if (target.status !== 'failed') {
        throw new UnderstandingPreconditionError('source_not_retryable');
      }
      return {
        ...session,
        mergeRun: undefined,
        runs: session.runs.map((run) =>
          run === target ? { source: run.source, status: 'pending' as const, threadId } : run,
        ),
      };
    });
    return { sourceId: input.sourceId, threadId };
  };

  confirm = (input: ConfirmOnboardingUnderstandingInput) =>
    this.dependencies.confirmation.confirm(input);

  private recoverRunningOperation = async (topicId: string, threadId: string) => {
    const topic = await this.dependencies.topic.findById(topicId);
    if (!topic) throw new UnderstandingResourceNotFoundError('topic');
    const operation = topic.metadata?.runningOperation;
    if (!operation || operation.threadId !== threadId) return;
    return {
      assistantMessageId: operation.assistantMessageId,
      operationId: operation.operationId,
    };
  };

  private activeSession = async (topicId: string, sessionId: string) => {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const session = await this.dependencies.sessions.get(topicId);
    if (!session) throw new UnderstandingSessionNotFoundError(topicId);
    if (session.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);
    return session;
  };

  private sourceRun = async (input: SourceIdentity) => {
    const session = await this.activeSession(input.topicId, input.sessionId);
    const run = session.runs.find(({ source }) => source.id === input.sourceId);
    if (!run || run.threadId !== input.threadId) {
      throw new StaleUnderstandingRunError('source', input.threadId);
    }
    return run;
  };

  private readTerminalSource = async (
    input: SourceIdentity,
    run: OnboardingUnderstandingSession['runs'][number],
    runtime: UnderstandingWorkflowRuntime,
  ) => {
    if (!terminalStatuses.has(run.status) || !run.assistantMessageId || !run.resultId) return;
    const result = await this.dependencies.results.readSource({
      assistantMessageId: run.assistantMessageId,
      sessionId: input.sessionId,
      sourceId: input.sourceId,
      threadId: input.threadId,
      topicId: input.topicId,
    });
    if (!result || result.resultId !== run.resultId) {
      throw new Error('Understanding source result is unavailable');
    }
    await runtime.sourceStore.deleteSourcePayload({
      ...input,
      userId: runtime.context.userId,
    });
    return result;
  };

  private readTerminalMerge = async (
    input: MergeIdentity,
    session: OnboardingUnderstandingSession,
  ) => {
    const run = session.mergeRun;
    if (!run || !terminalStatuses.has(run.status) || !run.assistantMessageId || !run.resultId)
      return;
    const result = await this.dependencies.results.readMerge({
      assistantMessageId: run.assistantMessageId,
      sessionId: input.sessionId,
      threadId: input.threadId,
      topicId: input.topicId,
    });
    if (!result || result.resultId !== run.resultId) {
      throw new Error('Understanding merge result is unavailable');
    }
    return result;
  };

  private branches = (session: OnboardingUnderstandingSession) =>
    session.runs.map(({ source, threadId }) => ({ sourceId: source.id, threadId }));

  private locator = (source: ResolvedUnderstandingSource): SourceCandidate => ({
    candidateId: source.candidateId,
    credentialOrigin: source.credentialOrigin,
    credentialReference: source.credentialReference,
    provider: source.provider,
  });

  private recoverSource = async (
    reference: UnderstandingSourceRef,
    runtime: UnderstandingWorkflowRuntime,
  ) => {
    const provider = runtime.registry.get(reference.provider);
    if (!provider) throw new Error('Understanding source provider is unavailable');
    const discovery = await discoverUnderstandingSources(
      { get: (id) => (id === provider.id ? provider : undefined), list: () => [provider] },
      runtime.context,
    );
    const resolved = discovery.sources.find(
      (source) =>
        source.provider === reference.provider &&
        source.externalAccountId === reference.externalAccountId,
    );
    if (resolved) return resolved;
    throw new Error('Understanding source credential is unavailable');
  };

  private completedMaterials = async (
    topicId: string,
    sessionId: string,
    session: OnboardingUnderstandingSession,
  ) =>
    Promise.all(
      session.runs
        .filter((run) => run.status === 'completed' && run.assistantMessageId && run.resultId)
        .map(async (run) => {
          const result = await this.dependencies.results.readSource({
            assistantMessageId: run.assistantMessageId!,
            sessionId,
            sourceId: run.source.id,
            threadId: run.threadId,
            topicId,
          });
          if (!result || result.kind !== 'source') {
            throw new Error('Understanding source result is unavailable for merge');
          }
          return { result, threadId: run.threadId };
        }),
    );

  private mergeFailureMetadata = (
    resultId: string,
    diagnostics: CollectionDiagnostics,
    materials: Array<{ threadId: string }>,
  ): UnderstandingMergedResult => ({
    diagnostics: combineDiagnostics([
      diagnostics,
      emptyDiagnostics(
        canonicalCollectionError(
          'merge',
          'merge analysis',
          'UNDERSTANDING_MERGE_ANALYSIS_FAILED',
          true,
        ),
      ),
    ]),
    inputThreadIds: materials.map(({ threadId }) => threadId),
    kind: 'merge_error',
    resultId,
  });
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
  const messageModel = new MessageModel(db, userId);
  const topicModel = new TopicModel(db, userId);
  const workflowRuntime = createRecoverableLazy(async (): Promise<UnderstandingWorkflowRuntime> => {
    const agent = await new AgentModel(db, userId).getBuiltinAgent(
      BUILTIN_AGENT_SLUGS.onboardingUnderstanding,
    );
    if (!agent) throw new Error('Onboarding Understanding agent is unavailable');
    const { context, registry } = materializeUnderstandingProviders(registrations, { db, userId });
    const agentRuntime = new AgentRuntimeService(db, userId, {
      queueService: null,
      snapshotStore: discardUnderstandingSnapshotStore,
    });
    return {
      agent: new AiAgentService(db, userId),
      agentId: agent.id,
      agentRuntime: {
        executeOperation: async (operationId) => {
          const state = await agentRuntime.executeSync(operationId, { maxSteps: 1 });
          return { status: state.status };
        },
      },
      context,
      registry,
      sourceStore: new UnderstandingSourceStore(),
    };
  });
  return new UnderstandingService({
    confirmation: new UnderstandingConfirmationRepository(db, userId),
    ids: randomUUID,
    messages: {
      readContent: async (assistantMessageId) =>
        (await messageModel.findById(assistantMessageId))?.content,
    },
    results: new UnderstandingResultRepository(db, userId),
    sessions: new UnderstandingSessionRepository(db, userId),
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
    workflowRuntime,
  });
};

interface TerminalizeUnderstandingWorkflowOptions {
  db: LobeChatDatabase;
  sessionId: string;
  topicId: string;
  userId: string;
  workflowRunId: string;
}

export const terminalizeUnderstandingWorkflow = ({
  db,
  sessionId,
  topicId,
  userId,
  workflowRunId,
}: TerminalizeUnderstandingWorkflowOptions) =>
  new UnderstandingSessionRepository(db, userId).terminalizeWorkflow(
    topicId,
    sessionId,
    workflowRunId,
    `merge-failure-${sessionId}`,
    canonicalCollectionError('understanding', 'workflow', 'UNDERSTANDING_WORKFLOW_FAILED', true),
  );
