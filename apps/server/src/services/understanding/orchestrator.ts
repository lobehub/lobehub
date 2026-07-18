import {
  StaleUnderstandingSessionError,
  UnderstandingPreconditionError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import { chainUnderstandingMerge, chainUnderstandingSource } from '@lobechat/prompts/understanding';
import type {
  CollectionDiagnostics,
  CollectionError,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
  UnderstandingMergeRun,
  UnderstandingSourceRun,
  UnderstandingSourceRunResult,
} from '@lobechat/types';
import {
  CollectionDiagnosticsSummarySchema,
  projectOnboardingUnderstandingSessionStatus,
  RequestTrigger,
  UnderstandingAnalysisSchema,
} from '@lobechat/types';

import { discoverUnderstandingSources } from './pipeline';
import type { UnderstandingProviderRegistry } from './providers';
import { toPublicUnderstandingSourceRef } from './providers';
import {
  boundCanonicalDiagnostics,
  canonicalCollectionError,
  MAX_AGENT_INPUT_LENGTH,
  MAX_SOURCE_BRIEF_LENGTH,
  sanitizeProviderDiagnostics,
} from './sanitizer';
import type {
  ResolvedUnderstandingSource,
  SourceCandidate,
  UnderstandingProviderContext,
} from './types';
import { UnderstandingSourceIdentificationError } from './types';

const UNDERSTANDING_AGENT_SLUG = 'onboarding-understanding';
const COLLECTION_LEASE_MS = 5 * 60 * 1000;
const OPERATION_ADOPTION_ATTEMPTS = 3;
const TERMINAL_SOURCE_STATUSES = new Set(['completed', 'failed', 'stale']);

interface AgentOperationRow {
  completedAt?: Date | null;
  status: string;
}

interface OperationRepository {
  findById: (operationId: string) => Promise<AgentOperationRow | null>;
}

interface SessionRepository {
  claimMerge: (topicId: string, sessionId: string, threadId: string) => Promise<boolean>;
  get: (topicId: string) => Promise<OnboardingUnderstandingSession | undefined>;
  install: (
    topicId: string,
    session: OnboardingUnderstandingSession,
    expectedPriorSessionId?: string,
  ) => Promise<OnboardingUnderstandingSession>;
  update: (
    topicId: string,
    sessionId: string,
    mutate: (session: OnboardingUnderstandingSession) => OnboardingUnderstandingSession,
  ) => Promise<OnboardingUnderstandingSession>;
}

interface ResultRepository {
  ensureThread: (input: {
    agentId: string;
    kind: 'merged' | 'source';
    threadId: string;
    topicId: string;
  }) => Promise<unknown>;
  persist: (input: {
    agentId: string;
    metadata: OnboardingUnderstandingMessageMetadata;
    operationId: string;
    sessionId: string;
    topicId: string;
  }) => Promise<OnboardingUnderstandingMessageMetadata>;
  read: (input: {
    operationId: string;
    sessionId: string;
    topicId: string;
  }) => Promise<OnboardingUnderstandingMessageMetadata | undefined>;
}

type ResultReadOutcome =
  | { status: 'error' }
  | { status: 'not_ready' }
  | { result: OnboardingUnderstandingMessageMetadata; status: 'ready' };

interface SourceStore {
  deleteSession: (input: { sessionId: string; userId: string }) => Promise<void>;
  deleteSourceLocator: (input: {
    runId: string;
    sessionId: string;
    userId: string;
  }) => Promise<void>;
  deleteSourcePayload: (input: {
    runId: string;
    sessionId: string;
    userId: string;
  }) => Promise<void>;
  get: (input: {
    runId: string;
    sessionId: string;
    userId: string;
  }) => Promise<{ brief: string; diagnostics: CollectionDiagnostics } | null>;
  getSessionErrors: (input: { sessionId: string; userId: string }) => Promise<CollectionError[]>;
  getSourceLocator: (input: {
    runId: string;
    sessionId: string;
    userId: string;
  }) => Promise<SourceCandidate | null>;
  put: (input: {
    brief: string;
    diagnostics: CollectionDiagnostics;
    runId: string;
    sessionId: string;
    userId: string;
  }) => Promise<void>;
  putSessionErrors: (input: {
    errors: CollectionError[];
    sessionId: string;
    userId: string;
  }) => Promise<void>;
  putSourceLocator: (input: {
    locator: SourceCandidate;
    runId: string;
    sessionId: string;
    userId: string;
  }) => Promise<void>;
}

interface AgentExecutor {
  execAgent: (input: {
    appContext: { threadId: string; topicId: string };
    autoStart: true;
    ephemeralUserMessage: string;
    instructions: string;
    maxSteps: number;
    prompt: string;
    slug: string;
    suppressUserMessage: true;
    trigger: RequestTrigger.Onboarding;
  }) => Promise<{
    agentId: string;
    assistantMessageId: string;
    operationId: string;
    success: boolean;
  }>;
}

export interface UnderstandingOrchestratorDependencies {
  agent: AgentExecutor;
  agentId?: string;
  collectionConcurrency?: number;
  context: UnderstandingProviderContext;
  ids: () => string;
  messages: { readContent: (assistantMessageId: string) => Promise<unknown> };
  now?: () => Date;
  operations: OperationRepository;
  registry: UnderstandingProviderRegistry;
  results: ResultRepository;
  runtime: { deleteAgentOperation: (operationId: string) => Promise<void> };
  sessions: SessionRepository;
  sourceStore: SourceStore;
  topic: { assertActiveOnboardingTopic: (topicId: string) => Promise<void> };
}

export type UnderstandingBackgroundScheduler = (task: () => Promise<void>) => void;

interface MergeSourceMaterial {
  analysis?: UnderstandingAnalysis;
  diagnostics: CollectionDiagnostics;
}

const emptyDiagnostics = (error?: CollectionError): CollectionDiagnostics => ({
  errors: error ? [error] : [],
  evidenceCount: 0,
  failedCount: error ? 1 : 0,
  succeededCount: 0,
});

const extractUnderstandingAnalysis = (content: unknown): UnderstandingAnalysis => {
  if (typeof content !== 'string') throw new TypeError('Understanding assistant output is missing');
  const trimmed = content.trim();
  if (!trimmed.startsWith('```')) return UnderstandingAnalysisSchema.parse(JSON.parse(trimmed));

  const firstNewline = trimmed.indexOf('\n');
  const closingFence = trimmed.lastIndexOf('```');
  if (firstNewline === -1 || closingFence <= firstNewline) {
    throw new SyntaxError('Understanding assistant output contains an invalid JSON fence');
  }
  return UnderstandingAnalysisSchema.parse(
    JSON.parse(trimmed.slice(firstNewline + 1, closingFence).trim()),
  );
};

const combineDiagnostics = (items: CollectionDiagnostics[]): CollectionDiagnostics =>
  boundCanonicalDiagnostics(
    items.reduce<CollectionDiagnostics>(
      (combined, diagnostics) => ({
        errors: [...combined.errors, ...diagnostics.errors],
        evidenceCount: combined.evidenceCount + diagnostics.evidenceCount,
        failedCount: combined.failedCount + diagnostics.failedCount,
        succeededCount: combined.succeededCount + diagnostics.succeededCount,
      }),
      emptyDiagnostics(),
    ),
  );

const reconcileMergedPronoun = (
  merged: UnderstandingAnalysis,
  sources: UnderstandingAnalysis[],
): UnderstandingAnalysis => {
  const explicitPronouns = new Map<string, string>();
  for (const { profile } of sources) {
    const pronoun = profile.pronoun.trim();
    if (pronoun.toLowerCase() === 'non-specific') continue;
    explicitPronouns.set(pronoun.toLowerCase(), pronoun);
  }
  const pronoun =
    explicitPronouns.size === 1 ? explicitPronouns.values().next().value! : 'non-specific';
  if (merged.profile.pronoun === pronoun) return merged;
  return { ...merged, profile: { ...merged.profile, pronoun } };
};

const matchesMergeIdentity = (
  current: UnderstandingMergeRun | undefined,
  expected: UnderstandingMergeRun,
) =>
  Boolean(
    current &&
    current.operationId === expected.operationId &&
    current.threadId === expected.threadId &&
    JSON.stringify(current.inputThreadIds) === JSON.stringify(expected.inputThreadIds) &&
    (!expected.assistantMessageId || current.assistantMessageId === expected.assistantMessageId),
  );

type AgentOperationAdoption =
  | { status: 'adopted' }
  | { error?: unknown; status: 'released' }
  | { error: unknown; status: 'unresolved' };

const mapConcurrent = async <Input>(
  inputs: Input[],
  concurrency: number,
  worker: (input: Input) => Promise<void>,
): Promise<void> => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      while (next < inputs.length) await worker(inputs[next++]);
    }),
  );
};

export class UnderstandingOrchestrator {
  private readonly collectionConcurrency: number;

  constructor(private readonly dependencies: UnderstandingOrchestratorDependencies) {
    this.collectionConcurrency = Math.max(1, dependencies.collectionConcurrency ?? 3);
  }

  private get agentId() {
    return this.dependencies.agentId ?? UNDERSTANDING_AGENT_SLUG;
  }

  private get now() {
    return this.dependencies.now?.() ?? new Date();
  }

  private sourceStoreReference = (sessionId: string, threadId: string) => ({
    runId: threadId,
    sessionId,
    userId: this.dependencies.context.userId,
  });

  private updateSourceRun = (
    topicId: string,
    sessionId: string,
    threadId: string,
    mutate: (run: UnderstandingSourceRun) => UnderstandingSourceRun,
  ) =>
    this.dependencies.sessions.update(topicId, sessionId, (session) => ({
      ...session,
      runs: session.runs.map((run) => (run.threadId === threadId ? mutate(run) : run)),
    }));

  private transitionSourceRun = async (
    topicId: string,
    sessionId: string,
    expected: UnderstandingSourceRun,
    mutate: (run: UnderstandingSourceRun) => UnderstandingSourceRun,
  ) => {
    let transitioned: UnderstandingSourceRun | undefined;
    await this.updateSourceRun(topicId, sessionId, expected.threadId, (current) => {
      if (
        current.status !== expected.status ||
        current.collectionAttemptId !== expected.collectionAttemptId ||
        current.operationId !== expected.operationId ||
        current.assistantMessageId !== expected.assistantMessageId
      ) {
        return current;
      }
      transitioned = mutate(current);
      return transitioned;
    });
    return transitioned;
  };

  private readPersistedResult = async (
    topicId: string,
    sessionId: string,
    operationId: string | undefined,
    provider: string,
    warnings: CollectionError[],
  ): Promise<ResultReadOutcome> => {
    if (!operationId) return { status: 'not_ready' };
    try {
      const result = await this.dependencies.results.read({ operationId, sessionId, topicId });
      return result ? { result, status: 'ready' } : { status: 'not_ready' };
    } catch {
      warnings.push(canonicalCollectionError(provider, 'result read', 'RESULT_READ_FAILED', true));
      return { status: 'error' };
    }
  };

  private cleanupAgentOperation = async (
    operationId: string,
    provider: string,
    warnings: CollectionError[],
  ) => {
    try {
      await this.dependencies.runtime.deleteAgentOperation(operationId);
      return true;
    } catch {
      warnings.push(
        canonicalCollectionError(
          provider,
          'agent operation cleanup',
          'AGENT_OPERATION_CLEANUP_FAILED',
          true,
        ),
      );
      return false;
    }
  };

  private adoptAgentOperation = async (input: {
    manifestHasOperation: () => Promise<boolean>;
    operationId: string;
    provider: string;
    releaseManifest: () => Promise<boolean>;
    updateManifest: () => Promise<boolean>;
  }): Promise<AgentOperationAdoption> => {
    let unresolvedError: unknown;
    for (let attempt = 0; attempt < OPERATION_ADOPTION_ATTEMPTS; attempt += 1) {
      let updateError: unknown;
      try {
        if (await input.updateManifest()) return { status: 'adopted' };
      } catch (error) {
        updateError = error;
        try {
          if (await input.manifestHasOperation()) return { status: 'adopted' };
        } catch {
          unresolvedError = error;
          if (attempt + 1 < OPERATION_ADOPTION_ATTEMPTS) continue;
        }
      }

      const cleaned = await this.cleanupAgentOperation(input.operationId, input.provider, []);
      if (cleaned) {
        for (
          let releaseAttempt = 0;
          releaseAttempt < OPERATION_ADOPTION_ATTEMPTS;
          releaseAttempt += 1
        ) {
          try {
            if (await input.releaseManifest()) {
              return {
                ...(updateError === undefined ? {} : { error: updateError }),
                status: 'released',
              };
            }
          } catch (error) {
            unresolvedError = error;
          }
          try {
            if (!(await input.manifestHasOperation())) {
              return {
                ...(updateError === undefined ? {} : { error: updateError }),
                status: 'released',
              };
            }
          } catch (error) {
            unresolvedError = error;
          }
        }
        return {
          error: unresolvedError ?? new Error('Unable to release agent operation manifest'),
          status: 'unresolved',
        };
      }
      unresolvedError = updateError ?? new Error('Unable to reconcile agent operation adoption');
    }
    return {
      error: unresolvedError ?? new Error('Unable to reconcile agent operation adoption'),
      status: 'unresolved',
    };
  };

  private cleanupSourceRun = async (
    sessionId: string,
    run: UnderstandingSourceRun,
    warnings: CollectionError[],
  ) => {
    let payloadCleaned = true;
    await this.dependencies.sourceStore
      .deleteSourcePayload(this.sourceStoreReference(sessionId, run.threadId))
      .catch(() => {
        payloadCleaned = false;
        warnings.push(
          canonicalCollectionError(run.source.provider, 'cleanup', 'SOURCE_CLEANUP_FAILED', true),
        );
      });
    const operationCleaned = await this.cleanupAgentOperation(
      run.operationId!,
      run.source.provider,
      warnings,
    );
    return payloadCleaned && operationCleaned;
  };

  private persistSourceFailureResult = async (
    topicId: string,
    sessionId: string,
    run: UnderstandingSourceRun,
    diagnostics: CollectionDiagnostics,
  ) => {
    if (!run.operationId || !run.assistantMessageId) return;
    await this.dependencies.results.persist({
      agentId: this.agentId,
      metadata: {
        diagnostics: boundCanonicalDiagnostics(diagnostics),
        kind: 'source_error',
        resultId: `result-${run.operationId}`,
        source: run.source,
      },
      operationId: run.operationId,
      sessionId,
      topicId,
    });
  };

  private sourceAnalysisFailureDiagnostics = (
    run: UnderstandingSourceRun,
    diagnostics: CollectionDiagnostics,
  ) =>
    boundCanonicalDiagnostics({
      ...diagnostics,
      errors: [
        ...diagnostics.errors,
        canonicalCollectionError(run.source.provider, 'analysis', 'SOURCE_ANALYSIS_FAILED', true),
      ],
      failedCount: diagnostics.failedCount + 1,
    });

  private mergeAnalysisFailureDiagnostics = (diagnostics: CollectionDiagnostics) =>
    boundCanonicalDiagnostics({
      ...diagnostics,
      errors: [
        ...diagnostics.errors,
        canonicalCollectionError('understanding', 'merge analysis', 'MERGE_ANALYSIS_FAILED', true),
      ],
      failedCount: diagnostics.failedCount + 1,
    });

  private failRun = async (
    topicId: string,
    sessionId: string,
    run: UnderstandingSourceRun,
    diagnostics: CollectionDiagnostics,
  ) => {
    const failedRun = await this.transitionSourceRun(topicId, sessionId, run, (current) => ({
      ...current,
      diagnostics: CollectionDiagnosticsSummarySchema.parse(diagnostics),
      status: 'failed',
    }));
    if (!failedRun) return;
    if (!failedRun.operationId) {
      await this.dependencies.sourceStore
        .put({
          ...this.sourceStoreReference(sessionId, failedRun.threadId),
          brief: '',
          diagnostics,
        })
        .catch(() => undefined);
    }
    await this.persistSourceFailureResult(topicId, sessionId, failedRun, diagnostics).catch(
      () => undefined,
    );
  };

  private markRunStale = async (
    topicId: string,
    sessionId: string,
    run: UnderstandingSourceRun,
  ) => {
    if (!['pending', 'resolving', 'collecting', 'analyzing'].includes(run.status)) return;
    await this.transitionSourceRun(topicId, sessionId, run, (current) => ({
      ...current,
      diagnostics: CollectionDiagnosticsSummarySchema.parse(
        emptyDiagnostics(
          canonicalCollectionError(
            run.source.provider,
            'temporary state recovery',
            'SOURCE_TEMPORARY_STATE_EXPIRED',
            true,
          ),
        ),
      ),
      status: 'stale',
    }));
  };

  private collectionLeaseExpired = (run: UnderstandingSourceRun) =>
    !run.collectionStartedAt ||
    this.now.getTime() - Date.parse(run.collectionStartedAt) >= COLLECTION_LEASE_MS;

  private initializationLeaseActive = (session: OnboardingUnderstandingSession) =>
    !session.initializedAt &&
    !!session.initializationStartedAt &&
    this.now.getTime() - Date.parse(session.initializationStartedAt) < COLLECTION_LEASE_MS;

  private claimExpiredCollectionRecovery = async (
    topicId: string,
    sessionId: string,
    run: UnderstandingSourceRun,
  ) => {
    let claimed: UnderstandingSourceRun | undefined;
    await this.updateSourceRun(topicId, sessionId, run.threadId, (current) => {
      if (
        current.status !== 'collecting' ||
        current.collectionAttemptId !== run.collectionAttemptId ||
        current.collectionStartedAt !== run.collectionStartedAt ||
        !this.collectionLeaseExpired(current)
      ) {
        return current;
      }
      claimed = {
        ...current,
        collectionAttemptId: this.dependencies.ids(),
        collectionStartedAt: this.now.toISOString(),
      };
      return claimed;
    });
    return claimed;
  };

  private renewCollectionOwnership = async (
    topicId: string,
    sessionId: string,
    run: UnderstandingSourceRun,
  ) => {
    if (!run.collectionAttemptId) return;
    let renewed: UnderstandingSourceRun | undefined;
    const collectionStartedAt = this.now.toISOString();
    await this.updateSourceRun(topicId, sessionId, run.threadId, (current) => {
      if (
        current.status !== 'collecting' ||
        current.collectionAttemptId !== run.collectionAttemptId
      ) {
        return current;
      }
      renewed = { ...current, collectionStartedAt };
      return renewed;
    });
    return renewed;
  };

  private launchSourceAnalysis = async (
    topicId: string,
    sessionId: string,
    run: UnderstandingSourceRun,
    brief: string,
    diagnostics: CollectionDiagnostics,
  ) => {
    await this.dependencies.results.ensureThread({
      agentId: this.agentId,
      kind: 'source',
      threadId: run.threadId,
      topicId,
    });
    const instruction = chainUnderstandingSource({
      diagnostics,
      provider: run.source.provider,
      sourceDisplayName: run.source.displayName,
    });
    const ownedRun = await this.renewCollectionOwnership(topicId, sessionId, run);
    if (!ownedRun) return;
    const result = await this.dependencies.agent.execAgent({
      appContext: { threadId: ownedRun.threadId, topicId },
      autoStart: true,
      ephemeralUserMessage: brief.slice(0, MAX_AGENT_INPUT_LENGTH),
      instructions: instruction,
      maxSteps: 1,
      prompt: 'Analyze onboarding understanding source.',
      slug: UNDERSTANDING_AGENT_SLUG,
      suppressUserMessage: true,
      trigger: RequestTrigger.Onboarding,
    });
    const launchDiagnostics = result.success
      ? diagnostics
      : this.sourceAnalysisFailureDiagnostics(ownedRun, diagnostics);
    const launched = {
      ...ownedRun,
      assistantMessageId: result.assistantMessageId,
      diagnostics: CollectionDiagnosticsSummarySchema.parse(launchDiagnostics),
      operationId: result.operationId,
      status: result.success ? ('analyzing' as const) : ('failed' as const),
    };
    const adoption = await this.adoptAgentOperation({
      manifestHasOperation: async () => {
        const session = await this.dependencies.sessions.get(topicId);
        const current = session?.runs.find(({ threadId }) => threadId === ownedRun.threadId);
        return Boolean(
          session?.id === sessionId &&
          current &&
          current.collectionAttemptId === ownedRun.collectionAttemptId &&
          current.operationId === result.operationId &&
          current.assistantMessageId === result.assistantMessageId,
        );
      },
      operationId: result.operationId,
      provider: ownedRun.source.provider,
      releaseManifest: async () => {
        let released = false;
        await this.updateSourceRun(topicId, sessionId, ownedRun.threadId, (current) => {
          if (
            current.collectionAttemptId !== ownedRun.collectionAttemptId ||
            current.operationId !== result.operationId ||
            current.assistantMessageId !== result.assistantMessageId
          ) {
            released = true;
            return current;
          }
          released = true;
          return ownedRun;
        });
        return released;
      },
      updateManifest: async () => {
        let adopted = false;
        await this.updateSourceRun(topicId, sessionId, ownedRun.threadId, (current) => {
          if (
            current.collectionAttemptId === ownedRun.collectionAttemptId &&
            current.operationId === result.operationId &&
            current.assistantMessageId === result.assistantMessageId
          ) {
            adopted = true;
            return current;
          }
          if (
            current.status !== 'collecting' ||
            current.collectionAttemptId !== ownedRun.collectionAttemptId
          ) {
            return current;
          }
          adopted = true;
          return launched;
        });
        return adopted;
      },
    });
    if (adoption.status !== 'adopted') {
      if (adoption.status === 'unresolved') return;
      return;
    }
    if (!result.success) {
      await this.persistSourceFailureResult(topicId, sessionId, launched, launchDiagnostics);
    }
  };

  private collectAndAnalyzeSource = async (
    topicId: string,
    sessionId: string,
    source: ResolvedUnderstandingSource,
    collectingRun: UnderstandingSourceRun,
  ) => {
    let diagnostics = emptyDiagnostics(
      canonicalCollectionError(source.provider, 'collection', 'SOURCE_COLLECTION_FAILED', true),
    );
    let brief: string;
    try {
      const provider = this.dependencies.registry.get(source.provider);
      if (!provider) throw new Error('Understanding provider is not registered');
      const collected = await provider.collect(source, this.dependencies.context);
      diagnostics = sanitizeProviderDiagnostics(source.provider, collected.diagnostics);
      brief = collected.sourceBrief.slice(0, MAX_SOURCE_BRIEF_LENGTH);
      if (!brief.trim() || diagnostics.succeededCount === 0) {
        diagnostics = boundCanonicalDiagnostics({
          ...diagnostics,
          errors: [
            ...diagnostics.errors,
            canonicalCollectionError(
              source.provider,
              'collection',
              'SOURCE_COLLECTION_EMPTY',
              true,
            ),
          ],
          failedCount: Math.max(1, diagnostics.failedCount),
        });
        throw new Error('Understanding source collection was empty');
      }
      const payloadOwner = await this.renewCollectionOwnership(topicId, sessionId, collectingRun);
      if (!payloadOwner) return;
      collectingRun = payloadOwner;
      await this.dependencies.sourceStore.put({
        ...this.sourceStoreReference(sessionId, collectingRun.threadId),
        brief,
        diagnostics,
      });
    } catch {
      const failureOwner = await this.renewCollectionOwnership(topicId, sessionId, collectingRun);
      if (failureOwner) await this.failRun(topicId, sessionId, failureOwner, diagnostics);
      return;
    }

    try {
      await this.launchSourceAnalysis(topicId, sessionId, collectingRun, brief, diagnostics);
    } catch {
      const failureOwner = await this.renewCollectionOwnership(topicId, sessionId, collectingRun);
      if (!failureOwner) return;
      const failureDiagnostics = this.sourceAnalysisFailureDiagnostics(failureOwner, diagnostics);
      await this.failRun(topicId, sessionId, failureOwner, failureDiagnostics);
    }
  };

  private advanceSourceFromCollectionToAnalysis = async (
    topicId: string,
    sessionId: string,
    source: ResolvedUnderstandingSource,
    run: UnderstandingSourceRun,
  ) => {
    let collectingRun: UnderstandingSourceRun | undefined;
    const collectionAttemptId = this.dependencies.ids();
    const collectionStartedAt = this.now.toISOString();
    await this.updateSourceRun(topicId, sessionId, run.threadId, (current) => {
      if (!['pending', 'resolving'].includes(current.status)) return current;
      collectingRun = {
        ...current,
        collectionAttemptId,
        collectionStartedAt,
        status: 'collecting',
      };
      return collectingRun;
    });
    if (!collectingRun) return;
    await this.collectAndAnalyzeSource(topicId, sessionId, source, collectingRun);
  };

  async start(
    { topicId }: { topicId: string },
    schedule: UnderstandingBackgroundScheduler,
  ): Promise<OnboardingUnderstandingPollingResult> {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const previousSession = await this.dependencies.sessions.get(topicId);
    if (
      previousSession &&
      !(
        previousSession.runs.length === 0 &&
        previousSession.status === 'failed' &&
        !previousSession.mergeRun
      )
    ) {
      schedule(() => this.resumePendingSources({ topicId }));
      return {
        id: previousSession.id,
        ...(previousSession.mergeRun ? { mergeRun: previousSession.mergeRun } : {}),
        runs: previousSession.runs,
        status: projectOnboardingUnderstandingSessionStatus(previousSession),
      };
    }
    const discovery = await discoverUnderstandingSources(
      this.dependencies.registry,
      this.dependencies.context,
    );
    const sessionId = this.dependencies.ids();
    const sourceRuns = discovery.sources.map((source) => ({
      run: {
        source: toPublicUnderstandingSourceRef(source),
        status: 'pending' as const,
        threadId: this.dependencies.ids(),
      },
      source,
    }));
    const session: OnboardingUnderstandingSession = {
      id: sessionId,
      initializationStartedAt: this.now.toISOString(),
      runs: sourceRuns.map(({ run }) => run),
      status: sourceRuns.length === 0 ? 'failed' : 'pending',
    };
    const installed = await this.dependencies.sessions.install(
      topicId,
      session,
      previousSession?.id,
    );
    if (installed.id !== session.id) {
      schedule(() => this.resumePendingSources({ topicId }));
      return {
        id: installed.id,
        ...(installed.mergeRun ? { mergeRun: installed.mergeRun } : {}),
        runs: installed.runs,
        status: projectOnboardingUnderstandingSessionStatus(installed),
      };
    }
    if (previousSession && previousSession.id !== installed.id) {
      await this.dependencies.sourceStore
        .deleteSession({
          sessionId: previousSession.id,
          userId: this.dependencies.context.userId,
        })
        .catch(() => undefined);
    }

    const warnings: CollectionError[] = [];
    if (discovery.errors.length > 0) {
      await this.dependencies.sourceStore
        .putSessionErrors({
          errors: discovery.errors,
          sessionId,
          userId: this.dependencies.context.userId,
        })
        .catch(() =>
          warnings.push(
            canonicalCollectionError(
              'understanding',
              'session error write',
              'SESSION_ERRORS_WRITE_FAILED',
              true,
            ),
          ),
        );
    }
    const locatorWrites = await Promise.allSettled(
      sourceRuns.map(({ run, source }) =>
        this.dependencies.sourceStore.putSourceLocator({
          locator: {
            candidateId: source.candidateId,
            credentialOrigin: source.credentialOrigin,
            credentialReference: source.credentialReference,
            provider: source.provider,
          },
          ...this.sourceStoreReference(sessionId, run.threadId),
        }),
      ),
    );
    if (locatorWrites.some(({ status }) => status === 'rejected')) {
      warnings.push(
        canonicalCollectionError(
          'understanding',
          'source locator write',
          'SOURCE_LOCATOR_WRITE_FAILED',
          true,
        ),
      );
    }

    await this.dependencies.sessions.update(topicId, sessionId, (current) => ({
      ...current,
      initializedAt: current.initializedAt ?? this.now.toISOString(),
    }));

    schedule(() =>
      mapConcurrent(sourceRuns, this.collectionConcurrency, ({ run, source }) =>
        this.advanceSourceFromCollectionToAnalysis(topicId, sessionId, source, run),
      ),
    );
    return {
      ...(discovery.errors.length ? { errors: discovery.errors } : {}),
      id: session.id,
      runs: session.runs,
      status: session.status,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  async resumePendingSources({ topicId }: { topicId: string }): Promise<void> {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const session = await this.dependencies.sessions.get(topicId);
    if (!session) throw new UnderstandingSessionNotFoundError(topicId);
    const initializationLeaseActive = this.initializationLeaseActive(session);
    await mapConcurrent(
      session.runs.filter((run) => ['pending', 'resolving', 'collecting'].includes(run.status)),
      this.collectionConcurrency,
      async (run) => {
        if (initializationLeaseActive && (run.status === 'pending' || run.status === 'resolving')) {
          return;
        }
        let recoveryRun = run;
        try {
          if (run.status === 'collecting') {
            if (!this.collectionLeaseExpired(run)) return;
            const claimed = await this.claimExpiredCollectionRecovery(topicId, session.id, run);
            if (!claimed) return;
            recoveryRun = claimed;
          }
          const locator = await this.dependencies.sourceStore.getSourceLocator(
            this.sourceStoreReference(session.id, recoveryRun.threadId),
          );
          if (!locator) {
            await this.markRunStale(topicId, session.id, recoveryRun);
            return;
          }
          if (run.status === 'collecting') {
            const payload = await this.dependencies.sourceStore.get(
              this.sourceStoreReference(session.id, recoveryRun.threadId),
            );
            if (payload) {
              await this.launchSourceAnalysis(
                topicId,
                session.id,
                recoveryRun,
                payload.brief,
                payload.diagnostics,
              );
              return;
            }
          }
          const provider = this.dependencies.registry.get(run.source.provider);
          const source = provider
            ? await provider.resolveSource(run.source, locator, this.dependencies.context)
            : null;
          if (!source) throw new Error('Understanding source recovery is unavailable');
          if (run.status === 'collecting') {
            await this.collectAndAnalyzeSource(topicId, session.id, source, recoveryRun);
          } else {
            await this.advanceSourceFromCollectionToAnalysis(
              topicId,
              session.id,
              source,
              recoveryRun,
            );
          }
        } catch {
          const failureRun =
            run.status === 'collecting'
              ? await this.renewCollectionOwnership(topicId, session.id, recoveryRun)
              : recoveryRun;
          if (failureRun) {
            await this.failRun(
              topicId,
              session.id,
              failureRun,
              emptyDiagnostics(
                canonicalCollectionError(
                  run.source.provider,
                  'resume',
                  'SOURCE_RESUME_FAILED',
                  true,
                ),
              ),
            );
          }
        }
      },
    );
  }

  private reconcileSource = async (
    topicId: string,
    sessionId: string,
    run: UnderstandingSourceRun,
    warnings: CollectionError[],
  ): Promise<void> => {
    if (!run.operationId || !run.assistantMessageId) return;
    const resultRead = await this.readPersistedResult(
      topicId,
      sessionId,
      run.operationId,
      run.source.provider,
      warnings,
    );
    if (resultRead.status === 'error') return;
    const existing = resultRead.status === 'ready' ? resultRead.result : undefined;
    if (existing?.kind === 'source' || existing?.kind === 'source_error') {
      const operation =
        existing.kind === 'source' && !run.completedAt
          ? await this.dependencies.operations.findById(run.operationId)
          : null;
      const completedAt =
        existing.kind === 'source'
          ? (run.completedAt ?? operation?.completedAt?.toISOString() ?? this.now.toISOString())
          : undefined;
      const cleanupCompleted =
        run.cleanupStatus === 'completed' ||
        (await this.cleanupSourceRun(sessionId, run, warnings));
      await this.updateSourceRun(topicId, sessionId, run.threadId, (current) => ({
        ...current,
        ...(cleanupCompleted ? { cleanupStatus: 'completed' as const } : {}),
        ...(completedAt ? { completedAt: current.completedAt ?? completedAt } : {}),
        diagnostics: CollectionDiagnosticsSummarySchema.parse(existing.diagnostics),
        status: existing.kind === 'source' ? 'completed' : 'failed',
      }));
      return;
    }

    const operation = await this.dependencies.operations.findById(run.operationId);
    if (!operation || !['done', 'error', 'interrupted', 'cancelled'].includes(operation.status)) {
      const payload = await this.dependencies.sourceStore
        .get(this.sourceStoreReference(sessionId, run.threadId))
        .catch(() => undefined);
      if (payload === null) await this.markRunStale(topicId, sessionId, run);
      return;
    }
    const payload = await this.dependencies.sourceStore
      .get(this.sourceStoreReference(sessionId, run.threadId))
      .catch(() => undefined);
    if (payload === undefined) return;
    if (payload === null && operation.status === 'done') {
      await this.markRunStale(topicId, sessionId, run);
      return;
    }
    const diagnostics =
      payload?.diagnostics ??
      emptyDiagnostics(
        canonicalCollectionError(run.source.provider, 'analysis', 'SOURCE_ANALYSIS_FAILED', true),
      );
    let metadata: OnboardingUnderstandingMessageMetadata;
    if (operation.status === 'done') {
      try {
        const content = await this.dependencies.messages.readContent(run.assistantMessageId);
        metadata = {
          analysis: extractUnderstandingAnalysis(content),
          diagnostics,
          kind: 'source',
          resultId: `result-${run.operationId}`,
          source: run.source,
        };
      } catch {
        const invalid = canonicalCollectionError(
          run.source.provider,
          'analysis output',
          'SOURCE_ANALYSIS_OUTPUT_INVALID',
          false,
        );
        metadata = {
          diagnostics: boundCanonicalDiagnostics({
            ...diagnostics,
            errors: [...diagnostics.errors, invalid],
            failedCount: diagnostics.failedCount + 1,
          }),
          kind: 'source_error',
          resultId: `result-${run.operationId}`,
          source: run.source,
        };
      }
    } else {
      metadata = {
        diagnostics: this.sourceAnalysisFailureDiagnostics(run, diagnostics),
        kind: 'source_error',
        resultId: `result-${run.operationId}`,
        source: run.source,
      };
    }

    try {
      await this.dependencies.results.persist({
        agentId: this.agentId,
        metadata,
        operationId: run.operationId,
        sessionId,
        topicId,
      });
      const cleanupCompleted = await this.cleanupSourceRun(sessionId, run, warnings);
      const completedAt =
        metadata.kind === 'source'
          ? (operation.completedAt?.toISOString() ?? this.now.toISOString())
          : undefined;
      await this.updateSourceRun(topicId, sessionId, run.threadId, (current) => ({
        ...current,
        ...(cleanupCompleted ? { cleanupStatus: 'completed' as const } : {}),
        ...(completedAt ? { completedAt: current.completedAt ?? completedAt } : {}),
        diagnostics: CollectionDiagnosticsSummarySchema.parse(metadata.diagnostics),
        status: metadata.kind === 'source' ? 'completed' : 'failed',
      }));
    } catch {
      warnings.push(
        canonicalCollectionError(
          run.source.provider,
          'result persistence',
          'SOURCE_RESULT_PERSIST_FAILED',
          true,
        ),
      );
      return;
    }
  };

  private loadMergeInputsWithDiagnostics = async (
    topicId: string,
    session: OnboardingUnderstandingSession,
    warnings: CollectionError[],
  ): Promise<MergeSourceMaterial[] | undefined> => {
    const outcomes = await Promise.all(
      session.runs.map(async (run) => {
        const resultRead = await this.readPersistedResult(
          topicId,
          session.id,
          run.operationId,
          run.source.provider,
          warnings,
        );
        if (resultRead.status === 'error') return;
        const result = resultRead.status === 'ready' ? resultRead.result : undefined;
        if (result?.kind === 'source') {
          return { analysis: result.analysis, diagnostics: result.diagnostics };
        }
        if (result?.kind === 'source_error') return { diagnostics: result.diagnostics };
        const summary = run.diagnostics ?? {
          evidenceCount: 0,
          failedCount: 0,
          succeededCount: 0,
        };
        return {
          diagnostics: boundCanonicalDiagnostics({
            ...summary,
            errors: [
              canonicalCollectionError(
                run.source.provider,
                'source result',
                'SOURCE_RESULT_UNAVAILABLE',
                true,
              ),
            ],
            failedCount: Math.max(1, summary.failedCount),
          }),
        };
      }),
    );
    if (outcomes.some((outcome) => !outcome)) return;
    return outcomes as MergeSourceMaterial[];
  };

  private adoptMergeOperation = (
    topicId: string,
    session: OnboardingUnderstandingSession,
    merge: UnderstandingMergeRun,
    reference: { assistantMessageId: string; operationId: string },
    diagnostics: CollectionDiagnostics,
    status: 'failed' | 'processing',
  ) =>
    this.adoptAgentOperation({
      manifestHasOperation: async () => {
        const durableSession = await this.dependencies.sessions.get(topicId);
        return Boolean(
          durableSession?.id === session.id &&
          matchesMergeIdentity(durableSession.mergeRun, { ...merge, ...reference }),
        );
      },
      operationId: reference.operationId,
      provider: 'understanding',
      releaseManifest: async () => {
        let released = false;
        await this.dependencies.sessions.update(topicId, session.id, (current) => {
          if (!matchesMergeIdentity(current.mergeRun, { ...merge, ...reference })) {
            released = true;
            return current;
          }
          const releasedMerge = { ...current.mergeRun! };
          delete releasedMerge.assistantMessageId;
          delete releasedMerge.operationId;
          released = true;
          return {
            ...current,
            mergeRun: { ...releasedMerge, status: 'processing' },
          };
        });
        return released;
      },
      updateManifest: async () => {
        let adopted = false;
        await this.dependencies.sessions.update(topicId, session.id, (current) => {
          if (
            !matchesMergeIdentity(current.mergeRun, merge) &&
            !matchesMergeIdentity(current.mergeRun, { ...merge, ...reference })
          ) {
            return current;
          }
          adopted = true;
          return {
            ...current,
            mergeRun: {
              ...current.mergeRun!,
              ...reference,
              diagnostics: CollectionDiagnosticsSummarySchema.parse(diagnostics),
              status,
            },
          };
        });
        return adopted;
      },
    });

  private advanceMergeLifecycle = async (
    topicId: string,
    session: OnboardingUnderstandingSession,
    warnings: CollectionError[],
  ) => {
    if (
      session.mergeRun?.status === 'processing' &&
      !session.mergeRun.operationId &&
      !session.mergeRun.assistantMessageId
    ) {
      const interruptedMerge = session.mergeRun;
      await this.dependencies.sessions.update(topicId, session.id, (current) => {
        if (
          current.mergeRun?.status !== 'processing' ||
          current.mergeRun.operationId ||
          current.mergeRun.assistantMessageId ||
          !matchesMergeIdentity(current.mergeRun, interruptedMerge)
        ) {
          return current;
        }
        return { ...current, mergeRun: { ...current.mergeRun, status: 'pending' } };
      });
      session = (await this.dependencies.sessions.get(topicId)) ?? session;
    }
    if (session.mergeRun && session.mergeRun.status !== 'pending') return;
    const materials = await this.loadMergeInputsWithDiagnostics(topicId, session, warnings);
    if (!materials) return;
    if (!session.mergeRun) {
      await this.dependencies.sessions.claimMerge(topicId, session.id, this.dependencies.ids());
      session = (await this.dependencies.sessions.get(topicId)) ?? session;
    }
    const merge = session.mergeRun;
    if (!merge || merge.status !== 'pending') return;

    let claimed = false;
    await this.dependencies.sessions.update(topicId, session.id, (current) => {
      if (
        current.mergeRun?.status !== 'pending' ||
        !matchesMergeIdentity(current.mergeRun, merge)
      ) {
        return current;
      }
      claimed = true;
      return {
        ...current,
        mergeRun: { ...current.mergeRun, status: 'processing' },
      };
    });
    if (!claimed) return;

    let diagnostics = emptyDiagnostics();
    let resultReference:
      | {
          assistantMessageId: string;
          operationId: string;
        }
      | undefined;
    try {
      const analyses = materials.flatMap(({ analysis }) => (analysis ? [analysis] : []));
      diagnostics = combineDiagnostics(materials.map(({ diagnostics }) => diagnostics));
      if (analyses.length === 0) throw new Error('Understanding merge has no inputs');
      await this.dependencies.results.ensureThread({
        agentId: this.agentId,
        kind: 'merged',
        threadId: merge.threadId,
        topicId,
      });
      const result = await this.dependencies.agent.execAgent({
        appContext: { threadId: merge.threadId, topicId },
        autoStart: true,
        ephemeralUserMessage: JSON.stringify(analyses).slice(0, MAX_AGENT_INPUT_LENGTH),
        instructions: chainUnderstandingMerge({ diagnostics }),
        maxSteps: 1,
        prompt: 'Merge onboarding understanding sources.',
        slug: UNDERSTANDING_AGENT_SLUG,
        suppressUserMessage: true,
        trigger: RequestTrigger.Onboarding,
      });
      resultReference = {
        assistantMessageId: result.assistantMessageId,
        operationId: result.operationId,
      };
      if (!result.success) throw new Error('Understanding merge agent failed to launch');
      await this.adoptMergeOperation(
        topicId,
        session,
        merge,
        resultReference,
        diagnostics,
        'processing',
      );
      return;
    } catch {
      const failureDiagnostics = this.mergeAnalysisFailureDiagnostics(diagnostics);
      let reference = resultReference ?? {
        assistantMessageId: this.dependencies.ids(),
        operationId: this.dependencies.ids(),
      };
      let referenced = false;
      if (resultReference) {
        let adoption = await this.adoptMergeOperation(
          topicId,
          session,
          merge,
          resultReference,
          failureDiagnostics,
          'failed',
        );
        if (adoption.status === 'unresolved') {
          adoption = await this.adoptMergeOperation(
            topicId,
            session,
            merge,
            resultReference,
            failureDiagnostics,
            'failed',
          );
        }
        referenced = adoption.status === 'adopted';
        if (adoption.status === 'released' && adoption.error) {
          resultReference = undefined;
          reference = {
            assistantMessageId: this.dependencies.ids(),
            operationId: this.dependencies.ids(),
          };
        } else if (!referenced) {
          return;
        }
      }
      if (!resultReference) {
        await this.dependencies.sessions
          .update(topicId, session.id, (current) => {
            if (!matchesMergeIdentity(current.mergeRun, merge)) return current;
            referenced = true;
            return {
              ...current,
              mergeRun: {
                ...current.mergeRun!,
                ...reference,
                diagnostics: CollectionDiagnosticsSummarySchema.parse(failureDiagnostics),
                status: 'failed',
              },
            };
          })
          .catch(() => undefined);
      }
      if (!referenced) return;

      const persisted = await this.dependencies.results
        .persist({
          agentId: this.agentId,
          metadata: {
            diagnostics: failureDiagnostics,
            inputThreadIds: merge.inputThreadIds,
            kind: 'merge_error',
            resultId: `result-${reference.operationId}`,
          },
          operationId: reference.operationId,
          sessionId: session.id,
          topicId,
        })
        .catch(() => undefined);
      if (!persisted) return;

      const referencedMerge: UnderstandingMergeRun = {
        ...merge,
        ...reference,
        diagnostics: CollectionDiagnosticsSummarySchema.parse(failureDiagnostics),
        status: 'failed',
      };
      await this.dependencies.sessions
        .update(topicId, session.id, (current) => {
          if (!matchesMergeIdentity(current.mergeRun, referencedMerge)) return current;
          return {
            ...current,
            mergeRun: {
              ...current.mergeRun!,
              diagnostics: CollectionDiagnosticsSummarySchema.parse(persisted.diagnostics),
              resultId: persisted.resultId,
              status: 'failed',
            },
          };
        })
        .catch(() => undefined);
    }
  };

  private reconcileMerge = async (
    topicId: string,
    session: OnboardingUnderstandingSession,
    warnings: CollectionError[],
  ) => {
    const merge = session.mergeRun;
    if (!merge?.operationId || !merge.assistantMessageId) return;
    const resultRead = await this.readPersistedResult(
      topicId,
      session.id,
      merge.operationId,
      'understanding',
      warnings,
    );
    if (resultRead.status === 'error') return;
    const existing = resultRead.status === 'ready' ? resultRead.result : undefined;
    if (existing?.kind === 'merged' || existing?.kind === 'merge_error') {
      const cleanupCompleted =
        merge.cleanupStatus === 'completed' ||
        (await this.cleanupAgentOperation(merge.operationId, 'understanding', warnings));
      await this.dependencies.sessions.update(topicId, session.id, (current) => {
        if (!matchesMergeIdentity(current.mergeRun, merge)) return current;
        return {
          ...current,
          mergeRun: {
            ...current.mergeRun!,
            ...(cleanupCompleted ? { cleanupStatus: 'completed' as const } : {}),
            diagnostics: CollectionDiagnosticsSummarySchema.parse(existing.diagnostics),
            resultId: existing.resultId,
            status: existing.kind === 'merged' ? 'completed' : 'failed',
          },
        };
      });
      return;
    }
    if (merge.status !== 'processing') return;
    const operation = await this.dependencies.operations.findById(merge.operationId);
    if (!operation || !['done', 'error', 'interrupted', 'cancelled'].includes(operation.status)) {
      return;
    }
    const materials = await this.loadMergeInputsWithDiagnostics(topicId, session, warnings);
    if (!materials) return;
    const diagnostics = combineDiagnostics(materials.map(({ diagnostics }) => diagnostics));
    let metadata: OnboardingUnderstandingMessageMetadata;
    if (operation.status === 'done') {
      try {
        const content = await this.dependencies.messages.readContent(merge.assistantMessageId);
        const sourceAnalyses = materials.flatMap(({ analysis }) => (analysis ? [analysis] : []));
        metadata = {
          analysis: reconcileMergedPronoun(extractUnderstandingAnalysis(content), sourceAnalyses),
          diagnostics,
          inputThreadIds: merge.inputThreadIds,
          kind: 'merged',
          resultId: `result-${merge.operationId}`,
        };
      } catch {
        metadata = {
          diagnostics: boundCanonicalDiagnostics({
            ...diagnostics,
            errors: [
              ...diagnostics.errors,
              canonicalCollectionError(
                'understanding',
                'merge output',
                'MERGE_ANALYSIS_OUTPUT_INVALID',
                false,
              ),
            ],
            failedCount: diagnostics.failedCount + 1,
          }),
          inputThreadIds: merge.inputThreadIds,
          kind: 'merge_error',
          resultId: `result-${merge.operationId}`,
        };
      }
    } else {
      metadata = {
        diagnostics: this.mergeAnalysisFailureDiagnostics(diagnostics),
        inputThreadIds: merge.inputThreadIds,
        kind: 'merge_error',
        resultId: `result-${merge.operationId}`,
      };
    }
    try {
      const result = await this.dependencies.results.persist({
        agentId: this.agentId,
        metadata,
        operationId: merge.operationId,
        sessionId: session.id,
        topicId,
      });
      const cleanupCompleted = await this.cleanupAgentOperation(
        merge.operationId,
        'understanding',
        warnings,
      );
      await this.dependencies.sessions.update(topicId, session.id, (current) => {
        if (!matchesMergeIdentity(current.mergeRun, merge)) return current;
        return {
          ...current,
          mergeRun: {
            ...current.mergeRun!,
            ...(cleanupCompleted ? { cleanupStatus: 'completed' as const } : {}),
            diagnostics: CollectionDiagnosticsSummarySchema.parse(result.diagnostics),
            resultId: result.resultId,
            status: result.kind === 'merged' ? 'completed' : 'failed',
          },
        };
      });
    } catch {
      warnings.push(
        canonicalCollectionError(
          'understanding',
          'merge result persistence',
          'MERGE_RESULT_PERSIST_FAILED',
          true,
        ),
      );
    }
  };

  async getSession({
    topicId,
  }: {
    topicId: string;
  }): Promise<OnboardingUnderstandingPollingResult> {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    let session = await this.dependencies.sessions.get(topicId);
    if (!session) throw new UnderstandingSessionNotFoundError(topicId);
    if (
      session.runs.some(
        (run) =>
          run.status === 'collecting' &&
          !run.operationId &&
          !run.assistantMessageId &&
          this.collectionLeaseExpired(run),
      )
    ) {
      await this.resumePendingSources({ topicId });
      session = (await this.dependencies.sessions.get(topicId))!;
    }
    const warnings: CollectionError[] = [];
    for (const run of session.runs) {
      await this.reconcileSource(topicId, session.id, run, warnings);
    }
    session = (await this.dependencies.sessions.get(topicId))!;

    const allTerminal = session.runs.every((run) => TERMINAL_SOURCE_STATUSES.has(run.status));
    if (allTerminal && session.runs.some((run) => run.status === 'completed')) {
      await this.advanceMergeLifecycle(topicId, session, warnings);
      session = (await this.dependencies.sessions.get(topicId))!;
    }
    await this.reconcileMerge(topicId, session, warnings);
    session = (await this.dependencies.sessions.get(topicId))!;

    const runs: UnderstandingSourceRunResult[] = await Promise.all(
      session.runs.map(async (run) => {
        const resultRead = await this.readPersistedResult(
          topicId,
          session!.id,
          run.operationId,
          run.source.provider,
          warnings,
        );
        return resultRead.status === 'ready' &&
          (resultRead.result.kind === 'source' || resultRead.result.kind === 'source_error')
          ? { ...run, result: resultRead.result }
          : run;
      }),
    );
    const mergeResultRead = await this.readPersistedResult(
      topicId,
      session.id,
      session.mergeRun?.operationId,
      'understanding',
      warnings,
    );
    const mergeResult = mergeResultRead.status === 'ready' ? mergeResultRead.result : undefined;
    const completed = runs
      .filter((run) => run.result?.kind === 'source')
      .sort(
        (left, right) =>
          (left.completedAt ? Date.parse(left.completedAt) : Number.MAX_SAFE_INTEGER) -
            (right.completedAt ? Date.parse(right.completedAt) : Number.MAX_SAFE_INTEGER) ||
          session!.runs.findIndex((run) => run.threadId === left.threadId) -
            session!.runs.findIndex((run) => run.threadId === right.threadId),
      );
    const displayResult =
      mergeResult?.kind === 'merged'
        ? { kind: 'merged' as const, result: mergeResult }
        : completed[0]?.result?.kind === 'source'
          ? { kind: 'provisional' as const, result: completed[0].result }
          : undefined;
    const sessionErrors = await this.dependencies.sourceStore
      .getSessionErrors({ sessionId: session.id, userId: this.dependencies.context.userId })
      .catch(() => {
        warnings.push(
          canonicalCollectionError(
            'understanding',
            'session error read',
            'SESSION_ERRORS_READ_FAILED',
            true,
          ),
        );
        return [];
      });
    const runErrors = (
      await Promise.all(
        runs.map(async (run) => {
          if (run.result) return run.result.diagnostics.errors;
          if (!['failed', 'stale'].includes(run.status)) return [];
          const payload = await this.dependencies.sourceStore
            .get(this.sourceStoreReference(session!.id, run.threadId))
            .catch(() => null);
          return payload?.diagnostics.errors ?? [];
        }),
      )
    ).flat();
    const mergeErrors =
      mergeResult?.diagnostics.errors.filter(({ code }) => code.startsWith('MERGE_')) ??
      (session.mergeRun?.status === 'failed'
        ? [
            canonicalCollectionError(
              'understanding',
              'merge analysis',
              'MERGE_ANALYSIS_FAILED',
              true,
            ),
          ]
        : []);
    const errors = boundCanonicalDiagnostics({
      errors: [...mergeErrors, ...sessionErrors, ...runErrors],
      evidenceCount: 0,
      failedCount: 0,
      succeededCount: 0,
    }).errors;

    return {
      ...(displayResult ? { displayResult } : {}),
      ...(errors.length ? { errors } : {}),
      id: session.id,
      ...(session.mergeRun
        ? {
            mergeRun:
              mergeResult?.kind === 'merged' || mergeResult?.kind === 'merge_error'
                ? { ...session.mergeRun, result: mergeResult }
                : session.mergeRun,
          }
        : {}),
      runs,
      status: projectOnboardingUnderstandingSessionStatus(session),
      ...(warnings.length ? { warnings } : {}),
    };
  }

  async retrySource({
    sessionId,
    sourceId,
    topicId,
  }: {
    sessionId: string;
    sourceId: string;
    topicId: string;
  }): Promise<OnboardingUnderstandingPollingResult> {
    await this.dependencies.topic.assertActiveOnboardingTopic(topicId);
    const session = await this.dependencies.sessions.get(topicId);
    if (!session) throw new UnderstandingSessionNotFoundError(topicId);
    if (session.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);
    const existing = session.runs.find((run) => run.source.id === sourceId);
    if (!existing || !['failed', 'stale'].includes(existing.status)) {
      throw new UnderstandingPreconditionError('source_not_retryable');
    }
    if (session.mergeRun && !['completed', 'failed'].includes(session.mergeRun.status)) {
      return this.getSession({ topicId });
    }

    const retryRun: UnderstandingSourceRun = {
      source: existing.source,
      status: 'resolving',
      threadId: this.dependencies.ids(),
    };
    let retryable = false;
    let source: ResolvedUnderstandingSource | undefined | null;
    try {
      if (existing.status === 'stale') {
        const discovery = await discoverUnderstandingSources(
          this.dependencies.registry,
          this.dependencies.context,
        );
        source = discovery.sources.find(
          ({ externalAccountId, provider }) =>
            provider === existing.source.provider &&
            externalAccountId === existing.source.externalAccountId,
        );
        if (!source) {
          retryable = discovery.errors.some(
            (error) => error.provider === existing.source.provider && error.retryable,
          );
        }
      } else {
        let locator: SourceCandidate | null;
        try {
          locator = await this.dependencies.sourceStore.getSourceLocator(
            this.sourceStoreReference(sessionId, existing.threadId),
          );
        } catch {
          retryable = true;
          throw new UnderstandingSourceIdentificationError({ retryable: true });
        }
        const provider = this.dependencies.registry.get(existing.source.provider);
        if (locator && provider) {
          try {
            source = await provider.resolveSource(
              existing.source,
              locator,
              this.dependencies.context,
            );
          } catch (error) {
            retryable = error instanceof UnderstandingSourceIdentificationError && error.retryable;
            throw error;
          }
        } else {
          source = null;
        }
      }
      if (!source) throw new Error('Understanding retry account is unavailable');
      try {
        await this.dependencies.sourceStore.putSourceLocator({
          locator: {
            candidateId: source.candidateId,
            credentialOrigin: source.credentialOrigin,
            credentialReference: source.credentialReference,
            provider: source.provider,
          },
          ...this.sourceStoreReference(sessionId, retryRun.threadId),
        });
      } catch {
        retryable = true;
        throw new UnderstandingSourceIdentificationError({ retryable: true });
      }
    } catch (error) {
      if (error instanceof UnderstandingSourceIdentificationError) retryable = error.retryable;
      const result = await this.getSession({ topicId });
      const retryError = canonicalCollectionError(
        existing.source.provider,
        'retry resolution',
        'SOURCE_RETRY_ACCOUNT_UNAVAILABLE',
        retryable,
      );
      return {
        ...result,
        errors: boundCanonicalDiagnostics({
          errors: [...(result.errors ?? []), retryError],
          evidenceCount: 0,
          failedCount: 1,
          succeededCount: 0,
        }).errors,
      };
    }

    let claimed = false;
    await this.dependencies.sessions.update(topicId, sessionId, (current) => {
      const currentRun = current.runs.find((run) => run.source.id === sourceId);
      if (
        !currentRun ||
        currentRun.threadId !== existing.threadId ||
        currentRun.status !== existing.status ||
        !['failed', 'stale'].includes(currentRun.status)
      ) {
        return current;
      }
      if (current.mergeRun && !['completed', 'failed'].includes(current.mergeRun.status)) {
        return current;
      }
      claimed = true;
      return {
        ...current,
        mergeRun: undefined,
        ...(current.mergeRun
          ? {
              retiredMergeRuns: [...(current.retiredMergeRuns ?? []), current.mergeRun],
            }
          : {}),
        retiredRuns: [...(current.retiredRuns ?? []), currentRun],
        runs: current.runs.map((run) => (run.threadId === existing.threadId ? retryRun : run)),
      };
    });
    if (!claimed) {
      await this.dependencies.sourceStore
        .deleteSourceLocator(this.sourceStoreReference(sessionId, retryRun.threadId))
        .catch(() => undefined);
      return this.getSession({ topicId });
    }

    await this.advanceSourceFromCollectionToAnalysis(topicId, sessionId, source, retryRun);
    return this.getSession({ topicId });
  }
}
