import type { SourceAgentSelfFeedbackIntentDeclared } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { createAgentSignalSelfIterationPrompt } from '@lobechat/prompts';
import { isNonEmptyString } from '@lobechat/utils';

import type { LobeChatDatabase } from '@/database/type';

import { defineSourceHandler } from '../../../runtime/middleware';
import { enqueueSelfIterationRun } from '../dispatch/enqueueSelfIterationRun';
import type { EvidenceRef } from '../types';
import { buildSelfFeedbackIntentSourceId, ReviewRunStatus } from '../types';

/** Source scope supported by self-feedback intent declarations. */
export type SelfFeedbackIntentSourceScopeType = 'operation' | 'topic';

/** Actions that an agent may declare as self-feedback intent. */
export type SelfFeedbackIntentDeclaredAction =
  | 'write'
  | 'create'
  | 'refine'
  | 'consolidate'
  | 'proposal';

/** Self-feedback target category declared by the running agent. */
export type SelfFeedbackIntentDeclaredKind = 'memory' | 'skill' | 'gap';

/**
 * Validated self-feedback intent source payload consumed by the handler.
 */
export interface SelfFeedbackIntentSourcePayload {
  /** Declared self-review action. */
  action: SelfFeedbackIntentDeclaredAction;
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Agent-declared confidence from 0 to 1. */
  confidence: number;
  /** Source-provided evidence references. */
  evidenceRefs: EvidenceRef[];
  /** Declared shared target category. */
  kind: SelfFeedbackIntentDeclaredKind;
  /** Existing memory id when the intent targets a memory. */
  memoryId?: string;
  /** Runtime operation id when the declaration is operation-scoped. */
  operationId?: string;
  /** Agent rationale for the declared intent. */
  reason: string;
  /** Scope id selected from operation or topic payload fields. */
  scopeId: string;
  /** Scope type selected from operation or topic payload fields. */
  scopeType: SelfFeedbackIntentSourceScopeType;
  /** Existing skill id when the intent targets a managed skill. */
  skillId?: string;
  /** Short declaration summary. */
  summary: string;
  /** Stable tool-call id used for source id verification. */
  toolCallId: string;
  /** Current topic id when available. */
  topicId?: string;
  /** Stable user id owning the agent. */
  userId: string;
}

/**
 * Idempotency and gate input shared by self-feedback intent handler dependencies.
 */
export interface SelfFeedbackIntentSourceGuardInput extends SelfFeedbackIntentSourcePayload {
  /** Stable guard key for one declaration source. */
  guardKey: string;
  /** Normalized source id that triggered the run. */
  sourceId: string;
}

/**
 * Context enrichment input for agent-declared self-feedback intent.
 */
export interface EnrichSelfFeedbackIntentEvidenceInput {
  /** Declared self-review action. */
  action: SelfFeedbackIntentDeclaredAction;
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Declared shared target category. */
  kind: SelfFeedbackIntentDeclaredKind;
  /** Runtime operation id when the declaration is operation-scoped. */
  operationId?: string;
  /** Scope id selected from operation or topic payload fields. */
  scopeId: string;
  /** Scope type selected from operation or topic payload fields. */
  scopeType: SelfFeedbackIntentSourceScopeType;
  /** Stable tool-call id used for source id verification. */
  toolCallId: string;
  /** Current topic id when available. */
  topicId?: string;
  /** Stable user id owning the agent. */
  userId: string;
}

/**
 * Extra evidence collected from the current operation or topic.
 */
export interface SelfFeedbackIntentEvidenceEnrichment {
  /** Additional evidence references to append before deterministic planning. */
  evidenceRefs: EvidenceRef[];
  /** Whether current context shows an explicit user instruction conflict. */
  hasUserInstructionConflict?: boolean;
}

/**
 * Result returned by the self-feedback intent source handler.
 */
export interface SelfFeedbackIntentSourceHandlerResult extends Record<string, unknown> {
  /** Stable agent id being reviewed when payload validation succeeds. */
  agentId?: string;
  /** Stable guard key used for idempotency when payload validation succeeds. */
  guardKey?: string;
  /** Operation id of the enqueued background self-iteration run, when dispatched. */
  operationId?: string;
  /** Machine-readable skip reason for non-dispatched runs. */
  reason?: 'gate_disabled' | 'invalid_payload';
  /** Runtime scope id reviewed by the run. */
  scopeId?: string;
  /** Runtime scope family reviewed by the run. */
  scopeType?: SelfFeedbackIntentSourceScopeType;
  /** Source id that triggered the run. */
  sourceId?: string;
  /** Coarse run status for observability and retry semantics. */
  status: ReviewRunStatus;
  /** Tool-call id that produced the declaration. */
  toolCallId?: string;
  /** Stable user id owning the agent when payload validation succeeds. */
  userId?: string;
}

/**
 * Dependencies required by the self-feedback intent source handler.
 */
export interface CreateSelfFeedbackIntentSourceHandlerDependencies {
  /** Acquires the per-declaration idempotency guard. */
  acquireReviewGuard: (input: SelfFeedbackIntentSourceGuardInput) => Promise<boolean>;
  /** Re-checks runtime gates before doing reviewer work. */
  canRunReview: (input: SelfFeedbackIntentSourceGuardInput) => Promise<boolean>;
  /** Postgres handle used by the dispatch helper to enqueue the execAgent run. */
  db: LobeChatDatabase;
  /** Enqueues the async self-iteration run. Overridable for tests. */
  dispatch?: typeof enqueueSelfIterationRun;
  /** Adds topic or operation evidence without mutating shared resources. */
  enrichEvidence?: (
    input: EnrichSelfFeedbackIntentEvidenceInput,
  ) => Promise<SelfFeedbackIntentEvidenceEnrichment>;
  /**
   * Maximum self-iteration runtime steps.
   *
   * @default builtin agent default
   */
  maxSteps?: number;
}

const isValidConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isSelfFeedbackIntentAction = (value: unknown): value is SelfFeedbackIntentDeclaredAction =>
  value === 'write' ||
  value === 'create' ||
  value === 'refine' ||
  value === 'consolidate' ||
  value === 'proposal';

const isSelfFeedbackIntentKind = (value: unknown): value is SelfFeedbackIntentDeclaredKind =>
  value === 'memory' || value === 'skill' || value === 'gap';

const isEvidenceRefType = (value: unknown): value is EvidenceRef['type'] =>
  value === 'topic' ||
  value === 'message' ||
  value === 'operation' ||
  value === 'source' ||
  value === 'receipt' ||
  value === 'tool_call' ||
  value === 'task' ||
  value === 'agent_document' ||
  value === 'memory';

const readEvidenceRefs = (value: unknown): EvidenceRef[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): EvidenceRef[] => {
    if (!item || typeof item !== 'object') return [];

    const id = 'id' in item ? item.id : undefined;
    const type = 'type' in item ? item.type : undefined;
    if (!isNonEmptyString(id) || !isEvidenceRefType(type)) return [];

    const summary = 'summary' in item ? item.summary : undefined;

    return [
      {
        id,
        ...(isNonEmptyString(summary) ? { summary } : {}),
        type,
      },
    ];
  });
};

const readSelfFeedbackIntentPayload = (
  source: SourceAgentSelfFeedbackIntentDeclared,
): SelfFeedbackIntentSourcePayload | undefined => {
  if (source.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared) return;

  const payload = source.payload;
  if (
    !isSelfFeedbackIntentAction(payload.action) ||
    !isNonEmptyString(payload.agentId) ||
    !isValidConfidence(payload.confidence) ||
    !isSelfFeedbackIntentKind(payload.kind) ||
    !isNonEmptyString(payload.reason) ||
    !isNonEmptyString(payload.summary) ||
    !isNonEmptyString(payload.toolCallId) ||
    !isNonEmptyString(payload.userId)
  ) {
    return;
  }

  const scope = isNonEmptyString(payload.operationId)
    ? ({ scopeId: payload.operationId, scopeType: 'operation' } as const)
    : isNonEmptyString(payload.topicId)
      ? ({ scopeId: payload.topicId, scopeType: 'topic' } as const)
      : undefined;

  if (!scope) return;

  return {
    action: payload.action,
    agentId: payload.agentId,
    confidence: payload.confidence,
    evidenceRefs: readEvidenceRefs(payload.evidenceRefs),
    kind: payload.kind,
    ...(isNonEmptyString(payload.memoryId) ? { memoryId: payload.memoryId } : {}),
    ...(isNonEmptyString(payload.operationId) ? { operationId: payload.operationId } : {}),
    reason: payload.reason,
    ...(isNonEmptyString(payload.skillId) ? { skillId: payload.skillId } : {}),
    scopeId: scope.scopeId,
    scopeType: scope.scopeType,
    summary: payload.summary,
    toolCallId: payload.toolCallId,
    ...(isNonEmptyString(payload.topicId) ? { topicId: payload.topicId } : {}),
    userId: payload.userId,
  };
};

const toGuardInput = (
  payload: SelfFeedbackIntentSourcePayload,
  source: SourceAgentSelfFeedbackIntentDeclared,
): SelfFeedbackIntentSourceGuardInput => {
  return {
    ...payload,
    guardKey: buildSelfFeedbackIntentSourceId({
      agentId: payload.agentId,
      scopeId: payload.scopeId,
      scopeType: payload.scopeType,
      toolCallId: payload.toolCallId,
      userId: payload.userId,
    }),
    sourceId: source.sourceId,
  };
};

const toEnrichEvidenceInput = (
  payload: SelfFeedbackIntentSourcePayload,
): EnrichSelfFeedbackIntentEvidenceInput => ({
  action: payload.action,
  agentId: payload.agentId,
  kind: payload.kind,
  ...(payload.operationId ? { operationId: payload.operationId } : {}),
  scopeId: payload.scopeId,
  scopeType: payload.scopeType,
  toolCallId: payload.toolCallId,
  ...(payload.topicId ? { topicId: payload.topicId } : {}),
  userId: payload.userId,
});

const toBaseResult = (
  guardInput: SelfFeedbackIntentSourceGuardInput,
): Omit<SelfFeedbackIntentSourceHandlerResult, 'status'> => ({
  agentId: guardInput.agentId,
  guardKey: guardInput.guardKey,
  scopeId: guardInput.scopeId,
  scopeType: guardInput.scopeType,
  sourceId: guardInput.sourceId,
  toolCallId: guardInput.toolCallId,
  userId: guardInput.userId,
});

/**
 * Builds the bounded self-iteration context embedded in the run prompt. Combines
 * the declared intent with any enrichment evidence, mirroring the old in-runtime
 * context — the builtin agent reads it from the prompt (no run-time collector).
 */
const createIntentRuntimeContext = ({
  enrichment,
  payload,
  sourceId,
}: {
  enrichment: SelfFeedbackIntentEvidenceEnrichment;
  payload: SelfFeedbackIntentSourcePayload;
  sourceId: string;
}) => ({
  agentId: payload.agentId,
  evidenceRefs: [...payload.evidenceRefs, ...enrichment.evidenceRefs],
  intent: payload,
  sourceId,
  userId: payload.userId,
});

/**
 * Creates the DI-friendly handler for self-feedback intent declaration sources.
 *
 * Triggering workflow:
 *
 * {@link createSelfFeedbackIntentSourcePolicyHandler}
 *   -> `agent.self_feedback_intent.declared`
 *     -> {@link createSelfFeedbackIntentSourceHandler}
 *
 * The handler validates the declaration, re-checks gates + idempotency, enriches
 * bounded evidence, then enqueues an async `execAgent` run under the builtin
 * `self-feedback-intent` agent. Receipts are projected by the completion path —
 * this handler does not run the model or write receipts inline.
 *
 * Expects:
 * - `source` is an `agent.self_feedback_intent.declared` source with service-produced payload
 * - Dependencies enforce gates, idempotency, and provide a db handle for dispatch
 *
 * Returns:
 * - A run result with `Dispatched` status + the enqueued operation id, or a
 *   `Skipped` / `Deduped` status when gates / idempotency reject the run
 */
export const createSelfFeedbackIntentSourceHandler = (
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies,
) => ({
  handle: async (
    source: SourceAgentSelfFeedbackIntentDeclared,
  ): Promise<SelfFeedbackIntentSourceHandlerResult> => {
    const payload = readSelfFeedbackIntentPayload(source);

    if (!payload) {
      return {
        reason: 'invalid_payload',
        sourceId: source.sourceId,
        status: ReviewRunStatus.Skipped,
      };
    }

    const guardInput = toGuardInput(payload, source);
    if (source.sourceId !== guardInput.guardKey) {
      return {
        reason: 'invalid_payload',
        sourceId: source.sourceId,
        status: ReviewRunStatus.Skipped,
      };
    }

    const baseResult = toBaseResult(guardInput);

    if (!(await deps.canRunReview(guardInput))) {
      return {
        ...baseResult,
        reason: 'gate_disabled',
        status: ReviewRunStatus.Skipped,
      };
    }

    if (!(await deps.acquireReviewGuard(guardInput))) {
      return {
        ...baseResult,
        status: ReviewRunStatus.Deduped,
      };
    }

    const enrichment = (await deps.enrichEvidence?.(toEnrichEvidenceInput(payload))) ?? {
      evidenceRefs: [],
    };

    const timestamp = new Date(source.timestamp).toISOString();
    const prompt = createAgentSignalSelfIterationPrompt({
      agentId: payload.agentId,
      context: createIntentRuntimeContext({ enrichment, payload, sourceId: source.sourceId }),
      mode: 'feedback',
      sourceId: source.sourceId,
      userId: payload.userId,
      window: { end: timestamp, start: timestamp },
    });

    const dispatch = deps.dispatch ?? enqueueSelfIterationRun;
    const { operationId } = await dispatch({
      agentId: payload.agentId,
      db: deps.db,
      marker: {
        agentId: payload.agentId,
        kind: 'self-feedback-intent',
        sourceId: source.sourceId,
        ...(payload.topicId ? { topicId: payload.topicId } : {}),
      },
      ...(deps.maxSteps ? { maxSteps: deps.maxSteps } : {}),
      prompt,
      slug: BUILTIN_AGENT_SLUGS.selfFeedbackIntent,
      ...(payload.topicId ? { topicId: payload.topicId } : {}),
      userId: payload.userId,
    });

    return {
      ...baseResult,
      operationId,
      status: ReviewRunStatus.Dispatched,
    };
  },
});

/**
 * Creates the runtime source handler definition for self-feedback intent policy composition.
 *
 * Triggering workflow:
 *
 * {@link defineSourceHandler}
 *   -> `agent.self_feedback_intent.declared`
 *     -> {@link createSelfFeedbackIntentSourcePolicyHandler}
 *
 * Use when:
 * - Default Agent Signal policies are composed with self-feedback intent dependencies
 * - The runtime source registry needs an installable source handler definition
 *
 * Returns:
 * - A source handler that concludes the runtime chain with the dispatch metadata
 */
export const createSelfFeedbackIntentSourcePolicyHandler = (
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies,
) => {
  const handler = createSelfFeedbackIntentSourceHandler(deps);

  return defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
    `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared}:shared-review`,
    async (source: SourceAgentSelfFeedbackIntentDeclared) => {
      const result = await handler.handle(source);

      return {
        concluded: result,
        status: 'conclude',
      };
    },
  );
};
