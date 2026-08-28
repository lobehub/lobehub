import { createHash, randomUUID } from 'node:crypto';

import type {
  AgentInterventionAllowedAction,
  AgentInterventionApprovalMode,
  AgentInterventionCustomExecutionResult,
  AgentInterventionExpectedRequestRevisionHashes,
  AgentInterventionExpectedVersions,
  AgentInterventionKind,
  AgentInterventionResolutionAction,
  AgentInterventionResolutionScope,
  AgentInterventionReviewContext,
  AgentInterventionRisk,
  AgentInterventionSanitizedRequest,
  AgentInterventionSource,
  AgentInterventionStatus,
  AgentInterventionSurface,
  AgentInterventionSystemActionEligibility,
  ChatToolPayload,
} from '@lobechat/types';
import { and, asc, eq, getTableColumns, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

import type { AgentInterventionItem, AgentInterventionResolutionItem } from '../schemas';
import {
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
  messagePlugins,
  messages,
  userSettings,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

export const AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH =
  'AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH';
export const AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH =
  'AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH';
export const AGENT_INTERVENTION_INVALID_BATCH = 'AGENT_INTERVENTION_INVALID_BATCH';
export const AGENT_INTERVENTION_INVALID_ACTION = 'AGENT_INTERVENTION_INVALID_ACTION';
export const AGENT_INTERVENTION_IDENTITY_CONFLICT = 'AGENT_INTERVENTION_IDENTITY_CONFLICT';
export const AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED =
  'AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED';
export const AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH =
  'AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const PG_UNIQUE_VIOLATION = '23505';

export const AGENT_INTERVENTION_CUSTOM_EXECUTION_MIN_LEASE_MS = 1000;
export const AGENT_INTERVENTION_CUSTOM_EXECUTION_MAX_LEASE_MS = 15 * 60_000;

type AgentInterventionOperationIdentity = Pick<
  typeof agentOperations.$inferSelect,
  'agentId' | 'appContext' | 'chatGroupId' | 'id' | 'status' | 'taskId' | 'threadId' | 'topicId'
>;

const isUniqueViolation = (error: unknown): boolean =>
  !!error &&
  typeof error === 'object' &&
  (('code' in error && (error as { code?: string }).code === PG_UNIQUE_VIOLATION) ||
    ('cause' in error && isUniqueViolation((error as { cause?: unknown }).cause)));

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

interface CanonicalJsonOptions {
  omitUndefinedObjectProperties?: boolean;
}

const canonicalJson = (
  value: unknown,
  options: CanonicalJsonOptions = {},
  ancestors = new Set<object>(),
): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Value is not JSON-safe');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('Value is not JSON-safe');
  if (ancestors.has(value)) throw new TypeError('Cyclic value is not JSON-safe');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        Object.keys(value).length !== value.length ||
        Reflect.ownKeys(value).length !== value.length + 1
      ) {
        throw new TypeError('Non-standard array is not JSON-safe');
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError('Sparse array is not JSON-safe');
        items.push(canonicalJson(value[index], options, ancestors));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Non-plain object is not JSON-safe');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (Reflect.ownKeys(record).length !== keys.length) {
      throw new TypeError('Hidden or symbol properties are not JSON-safe');
    }
    const serializedKeys = options.omitUndefinedObjectProperties
      ? keys.filter((key) => record[key] !== undefined)
      : keys;
    return `{${serializedKeys
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], options, ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
};

const sameJson = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

const canonicalDtoJson = (value: unknown): string =>
  canonicalJson(value, { omitUndefinedObjectProperties: true });

const sameDtoJson = (left: unknown, right: unknown): boolean =>
  canonicalDtoJson(left) === canonicalDtoJson(right);

const normalizeDtoJson = <T>(value: T): T => JSON.parse(canonicalDtoJson(value)) as T;

const isCanonicalJsonSafe = (value: unknown): boolean => {
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
};

const isCanonicalDtoJsonSafe = (value: unknown): boolean => {
  try {
    canonicalDtoJson(value);
    return true;
  } catch {
    return false;
  }
};

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort();

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isCustomExecutionResult = (value: unknown): value is AgentInterventionCustomExecutionResult =>
  isPlainRecord(value) &&
  hasOnlyKeys(value, ['content', 'pluginState']) &&
  typeof value.content === 'string' &&
  isPlainRecord(value.pluginState) &&
  isCanonicalJsonSafe(value);

const hasOnlyKeys = (record: Record<string, unknown>, allowedKeys: readonly string[]): boolean => {
  const allowed = new Set(allowedKeys);
  return Object.keys(record).every((key) => allowed.has(key));
};

const hasExactKeys = (record: Record<string, unknown>, ids: string[]): boolean => {
  const keys = Object.keys(record).sort();
  const expected = [...ids].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const actionCapability = (
  action: AgentInterventionResolutionAction,
): AgentInterventionAllowedAction => action.type;

const terminalStatusForAction = (
  action: AgentInterventionResolutionAction,
): 'cancelled' | 'resolved' =>
  action.type === 'cancel_interaction' || action.type === 'stop' ? 'cancelled' : 'resolved';

/** Exact digest used for CAS against the authoritative message plugin string. */
export const hashAgentInterventionRequestRevision = (argumentsText: string): string =>
  createHash('sha256').update(argumentsText).digest('hex');

const providerOptionIds = (request: AgentInterventionSanitizedRequest): Set<string> => {
  const ids = new Set<string>();
  for (const option of request.options ?? []) if (option.id) ids.add(option.id);
  for (const question of request.questions ?? []) {
    for (const option of question.options) if (option.id) ids.add(option.id);
  }
  for (const field of request.fields ?? []) {
    for (const option of field.options ?? []) if (option.id) ids.add(option.id);
  }
  return ids;
};

const isBoundedFormValue = (value: unknown): boolean => {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 10_000;
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((item) => typeof item === 'string' && item.length <= 10_000)
  );
};

const hasBoundedFormRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const record = value;
  const entries = Object.entries(record);
  return (
    entries.length <= 100 &&
    entries.every(([key, item]) => key.length > 0 && key.length <= 256 && isBoundedFormValue(item))
  );
};

const hasValidAnswers = (
  request: AgentInterventionSanitizedRequest,
  answersValue: unknown,
): boolean => {
  if (!hasBoundedFormRecord(answersValue)) return false;
  const answers = answersValue;
  const definitions = new Map<
    string,
    {
      allowCustomAnswer: boolean;
      multi: boolean;
      options: Set<string>;
      required: boolean;
      type: 'boolean' | 'number' | 'string';
    }
  >();
  for (const question of request.questions ?? []) {
    definitions.set(question.id ?? question.question, {
      allowCustomAnswer: question.allowCustomAnswer === true,
      multi: question.multiSelect === true,
      options: new Set(question.options.map((option) => option.id ?? option.label)),
      required: true,
      type: 'string',
    });
  }
  for (const field of request.fields ?? []) {
    definitions.set(field.id, {
      allowCustomAnswer: false,
      multi: field.type === 'multi_select',
      options: new Set((field.options ?? []).map((option) => option.id ?? option.label)),
      required: field.required === true,
      type: field.type === 'boolean' ? 'boolean' : field.type === 'number' ? 'number' : 'string',
    });
  }
  const { allowFreeform = false, allowSupplement = false } = request.answerPolicy ?? {};
  if (definitions.size === 0 && !allowFreeform) return false;
  const allowedSpecialKeys = new Set<string>();
  if (allowFreeform) allowedSpecialKeys.add('__freeform__');
  if (allowSupplement) allowedSpecialKeys.add('__supplement__');
  if (
    Object.keys(answers).some((key) => !definitions.has(key) && !allowedSpecialKeys.has(key)) ||
    ('__freeform__' in answers && typeof answers.__freeform__ !== 'string') ||
    ('__supplement__' in answers && typeof answers.__supplement__ !== 'string')
  ) {
    return false;
  }
  const hasFreeform = typeof answers.__freeform__ === 'string' && answers.__freeform__.length > 0;

  for (const [id, definition] of definitions) {
    const value = answers[id];
    if (value === undefined || value === null) {
      if (definition.required && !hasFreeform) return false;
      continue;
    }
    if (definition.multi) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return false;
      if (
        definition.options.size > 0 &&
        value.some((item) => !definition.options.has(item as string))
      ) {
        return false;
      }
      continue;
    }
    if (Array.isArray(value) || typeof value !== definition.type) return false;
    if (
      definition.options.size > 0 &&
      (typeof value !== 'string' ||
        (!definition.options.has(value) && !definition.allowCustomAnswer))
    ) {
      return false;
    }
  }
  return true;
};

const hasValidCustomDetail = (request: AgentInterventionSanitizedRequest): boolean => {
  const detailValue: unknown = request.customDetail;
  if (detailValue === undefined) return true;
  if (!isPlainRecord(detailValue)) return false;
  const agentsValue = detailValue.agents;
  if (
    !hasOnlyKeys(detailValue, ['agents', 'categoryHints', 'kind', 'requestId', 'selectedIds']) ||
    detailValue.kind !== 'agent_marketplace' ||
    !Array.isArray(agentsValue) ||
    agentsValue.length > 100
  ) {
    return false;
  }
  const detail = detailValue;
  const agents: unknown[] = agentsValue;
  const ids = agents.map((agent) => (isPlainRecord(agent) ? agent.id : undefined));
  if (
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length ||
    agents.some(
      (agent) =>
        !isPlainRecord(agent) ||
        !hasOnlyKeys(agent, ['avatar', 'description', 'id', 'title']) ||
        typeof agent.id !== 'string' ||
        !agent.id ||
        agent.id.length > 256 ||
        typeof agent.title !== 'string' ||
        !agent.title ||
        agent.title.length > 500 ||
        (agent.avatar !== undefined &&
          (typeof agent.avatar !== 'string' || agent.avatar.length > 2048)) ||
        (agent.description !== undefined &&
          (typeof agent.description !== 'string' || agent.description.length > 10_000)),
    ) ||
    (detail.selectedIds !== undefined &&
      (!Array.isArray(detail.selectedIds) ||
        detail.selectedIds.length > 100 ||
        detail.selectedIds.some((id) => typeof id !== 'string' || !ids.includes(id)) ||
        new Set(detail.selectedIds).size !== detail.selectedIds.length)) ||
    (detail.categoryHints !== undefined &&
      (!Array.isArray(detail.categoryHints) ||
        detail.categoryHints.length > 50 ||
        detail.categoryHints.some(
          (hint) => typeof hint !== 'string' || !hint || hint.length > 256,
        ))) ||
    (detail.requestId !== undefined &&
      (typeof detail.requestId !== 'string' || !detail.requestId || detail.requestId.length > 256))
  ) {
    return false;
  }
  return true;
};

const hasValidCustomResult = (
  request: AgentInterventionSanitizedRequest,
  resultValue: unknown,
): boolean => {
  if (!hasBoundedFormRecord(resultValue)) return false;
  const detail = request.customDetail;
  if (!detail) return true;
  if (detail.kind === 'agent_marketplace') {
    const result = resultValue;
    if (!hasExactKeys(result, ['selectedIds']) || !Array.isArray(result.selectedIds)) return false;
    const allowedIds = new Set(detail.agents.map((agent) => agent.id));
    return (
      new Set(result.selectedIds).size === result.selectedIds.length &&
      result.selectedIds.every((id) => typeof id === 'string' && allowedIds.has(id))
    );
  }
  return false;
};

export interface AgentInterventionLocator {
  activityKey: string;
  batchId: string;
  deadline: Date;
  id: string;
  operationId: string;
  source: AgentInterventionSource;
  status: AgentInterventionStatus;
  userId: string;
  workspaceId: null | string;
}

export interface AgentInterventionResolutionLocator {
  batchId: string;
  operationId: string;
  source: AgentInterventionSource;
  userId: string;
  workspaceId: null | string;
}

export interface ClaimAgentInterventionCustomExecutionParams {
  inputHash: string;
  leaseDurationMs: number;
  resolutionRequestId: string;
}

export type AgentInterventionCustomExecutionClaimResult =
  | {
      attempt: number;
      leaseExpiresAt: Date;
      leaseToken: string;
      outcome: 'applied';
    }
  | {
      attempt: number;
      leaseExpiresAt: Date;
      outcome: 'in_progress';
    }
  | {
      outcome: 'completed';
      result: AgentInterventionCustomExecutionResult;
    }
  | { outcome: 'conflict' };

export interface CompleteAgentInterventionCustomExecutionParams {
  inputHash: string;
  leaseToken: string;
  resolutionRequestId: string;
  result: AgentInterventionCustomExecutionResult;
}

export type AgentInterventionCustomExecutionCompletionResult =
  | {
      outcome: 'completed';
      result: AgentInterventionCustomExecutionResult;
    }
  | { outcome: 'conflict' };

type AgentInterventionPrivateExecutionField =
  | 'customExecutionAttempt'
  | 'customExecutionInputHash'
  | 'customExecutionLeaseExpiresAt'
  | 'customExecutionLeaseToken'
  | 'customExecutionResult'
  | 'customExecutionState';

export type AgentInterventionResolutionPublicItem = Omit<
  AgentInterventionResolutionItem,
  AgentInterventionPrivateExecutionField
>;

const {
  customExecutionAttempt: _customExecutionAttempt,
  customExecutionInputHash: _customExecutionInputHash,
  customExecutionLeaseExpiresAt: _customExecutionLeaseExpiresAt,
  customExecutionLeaseToken: _customExecutionLeaseToken,
  customExecutionResult: _customExecutionResult,
  customExecutionState: _customExecutionState,
  ...publicResolutionColumns
} = getTableColumns(agentInterventionResolutions);

export interface AgentInterventionBatchState {
  interventions: AgentInterventionItem[];
  resolutions: AgentInterventionResolutionPublicItem[];
}

export interface CreateAgentInterventionItemParams {
  allowedActions: readonly AgentInterventionAllowedAction[];
  canonicalToolKey?: string;
  interactionKind: AgentInterventionKind;
  provider?: string;
  requestRevisionHash: string;
  reviewContext: AgentInterventionReviewContext;
  reviewTokenHash: string;
  risk?: AgentInterventionRisk;
  sanitizedRequest: AgentInterventionSanitizedRequest;
  surface: AgentInterventionSurface;
  toolCallId: string;
  toolMessageId?: string;
}

export interface CreateAgentInterventionBatchParams {
  activityKey: string;
  approvalMode?: AgentInterventionApprovalMode;
  batchId: string;
  deadline: Date;
  items: CreateAgentInterventionItemParams[];
  operationId: string;
  provider?: string;
  source: AgentInterventionSource;
  stepIndex: number;
  systemActionEligibility: AgentInterventionSystemActionEligibility;
}

export interface AgentInterventionBatchSupersession {
  activityKey: string;
  batchId: string;
  operationId: string;
  toolCallIds: readonly string[];
}

export interface CreateAgentInterventionBatchWithSupersessionParams {
  batch: CreateAgentInterventionBatchParams;
  supersedes?: AgentInterventionBatchSupersession;
}

export interface AgentInterventionBatchSupersessionResult {
  interventions: AgentInterventionItem[];
  outcome: 'applied' | 'idempotent';
  superseded?: {
    activityKey: string;
    batchId: string;
    interventions: AgentInterventionItem[];
    operationId: string;
  };
}

export interface ClaimAgentInterventionBatchParams {
  action: AgentInterventionResolutionAction;
  actorId: string;
  batchId: string;
  expectedItemCount: number;
  expectedRequestRevisionHashes: AgentInterventionExpectedRequestRevisionHashes;
  expectedVersions: AgentInterventionExpectedVersions;
  operationId: string;
  resolutionRequestId: string;
  scope: AgentInterventionResolutionScope;
  selectedInterventionIds: string[];
}

export type AgentInterventionBatchMutationResult =
  | {
      interventions: AgentInterventionItem[];
      outcome: 'applied' | 'idempotent';
      resolution: AgentInterventionResolutionItem;
    }
  | {
      interventions?: AgentInterventionItem[];
      outcome: 'conflict' | 'not_found';
      resolution?: AgentInterventionResolutionItem;
    };

/**
 * Durable, owner-scoped state machine. Review-token lookup is deliberately a
 * separate system locator: callers must authorize view and resolve against the
 * resource before constructing this owner/workspace-scoped model.
 */
export class AgentInterventionModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private ownership = () =>
    and(
      eq(agentInterventions.userId, this.userId),
      this.workspaceId
        ? eq(agentInterventions.workspaceId, this.workspaceId)
        : isNull(agentInterventions.workspaceId),
    );

  private resolutionOwnership = () =>
    and(
      eq(agentInterventionResolutions.userId, this.userId),
      this.workspaceId
        ? eq(agentInterventionResolutions.workspaceId, this.workspaceId)
        : isNull(agentInterventionResolutions.workspaceId),
    );

  private ownerOnly = () => eq(agentInterventions.userId, this.userId);

  /**
   * System-only locator. It returns only routing/ACL context and never exposes
   * render content, action capability, token hash, or resolution payload.
   */
  static locateByReviewTokenHash = async (
    db: LobeChatDatabase,
    reviewTokenHash: string,
  ): Promise<AgentInterventionLocator | undefined> => {
    if (!HASH_PATTERN.test(reviewTokenHash)) return undefined;

    const [row] = await db
      .select({
        activityKey: agentInterventions.activityKey,
        batchId: agentInterventions.batchId,
        deadline: agentInterventions.deadline,
        id: agentInterventions.id,
        operationId: agentInterventions.operationId,
        source: agentInterventions.source,
        status: agentInterventions.status,
        userId: agentInterventions.userId,
        workspaceId: agentInterventions.workspaceId,
      })
      .from(agentInterventions)
      .where(eq(agentInterventions.reviewTokenHash, reviewTokenHash))
      .limit(1);

    return row;
  };

  /**
   * System-only compatibility locator for authenticated in-conversation
   * actions. The correlation pair is not authority: callers must still load
   * the owning operation, apply resource ACL, and then rebuild the
   * owner/workspace-scoped model before reading or claiming the batch.
   */
  static locateByOperationAndToolCall = async (
    db: LobeChatDatabase,
    operationId: string,
    toolCallId: string,
  ): Promise<AgentInterventionLocator | undefined> => {
    if (!operationId.trim() || !toolCallId.trim()) return undefined;

    const [row] = await db
      .select({
        activityKey: agentInterventions.activityKey,
        batchId: agentInterventions.batchId,
        deadline: agentInterventions.deadline,
        id: agentInterventions.id,
        operationId: agentInterventions.operationId,
        source: agentInterventions.source,
        status: agentInterventions.status,
        userId: agentInterventions.userId,
        workspaceId: agentInterventions.workspaceId,
      })
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.operationId, operationId),
          eq(agentInterventions.toolCallId, toolCallId),
        ),
      )
      .limit(1);

    return row;
  };

  /** System-only owner/workspace recovery for post-claim delivery callbacks. */
  static locateByResolutionRequestId = async (
    db: LobeChatDatabase,
    resolutionRequestId: string,
  ): Promise<AgentInterventionResolutionLocator | undefined> => {
    if (!UUID_PATTERN.test(resolutionRequestId)) return undefined;
    const [row] = await db
      .select({
        batchId: agentInterventionResolutions.batchId,
        operationId: agentInterventionResolutions.operationId,
        source: agentInterventionResolutions.source,
        userId: agentInterventionResolutions.userId,
        workspaceId: agentInterventionResolutions.workspaceId,
      })
      .from(agentInterventionResolutions)
      .where(eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId))
      .limit(1);
    return row;
  };

  /**
   * Atomically claims a short custom-execution lease without holding a database
   * transaction across the external side effect. A completed claim replays the
   * exact durable private result; a live lease never exposes its fencing token.
   */
  claimCustomExecution = async (
    params: ClaimAgentInterventionCustomExecutionParams,
    now = new Date(),
  ): Promise<AgentInterventionCustomExecutionClaimResult> => {
    if (
      !UUID_PATTERN.test(params.resolutionRequestId) ||
      !HASH_PATTERN.test(params.inputHash) ||
      !Number.isSafeInteger(params.leaseDurationMs) ||
      params.leaseDurationMs < AGENT_INTERVENTION_CUSTOM_EXECUTION_MIN_LEASE_MS ||
      params.leaseDurationMs > AGENT_INTERVENTION_CUSTOM_EXECUTION_MAX_LEASE_MS ||
      Number.isNaN(now.getTime())
    ) {
      return { outcome: 'conflict' };
    }

    return this.db.transaction(async (tx) => {
      const [resolution] = await tx
        .select()
        .from(agentInterventionResolutions)
        .where(
          and(
            eq(agentInterventionResolutions.resolutionRequestId, params.resolutionRequestId),
            this.resolutionOwnership(),
          ),
        )
        .limit(1)
        .for('update');
      if (!resolution || resolution.action.type !== 'submit_custom') {
        return { outcome: 'conflict' };
      }
      if (
        resolution.customExecutionInputHash &&
        resolution.customExecutionInputHash !== params.inputHash
      ) {
        return { outcome: 'conflict' };
      }

      if (resolution.customExecutionState === 'completed') {
        return resolution.customExecutionResult
          ? { outcome: 'completed', result: resolution.customExecutionResult }
          : { outcome: 'conflict' };
      }
      if (resolution.status !== 'resolving') {
        return { outcome: 'conflict' };
      }

      if (resolution.customExecutionState === 'executing') {
        if (
          !resolution.customExecutionLeaseToken ||
          !resolution.customExecutionLeaseExpiresAt ||
          resolution.customExecutionAttempt === null
        ) {
          return { outcome: 'conflict' };
        }
        if (resolution.customExecutionLeaseExpiresAt.getTime() > now.getTime()) {
          return {
            attempt: resolution.customExecutionAttempt,
            leaseExpiresAt: resolution.customExecutionLeaseExpiresAt,
            outcome: 'in_progress',
          };
        }
      } else if (
        resolution.customExecutionState !== 'pending' &&
        resolution.customExecutionState !== null
      ) {
        return { outcome: 'conflict' };
      }

      const attempt = (resolution.customExecutionAttempt ?? 0) + 1;
      const leaseExpiresAt = new Date(now.getTime() + params.leaseDurationMs);
      const leaseToken = randomUUID();
      const [claimed] = await tx
        .update(agentInterventionResolutions)
        .set({
          customExecutionAttempt: attempt,
          customExecutionInputHash: params.inputHash,
          customExecutionLeaseExpiresAt: leaseExpiresAt,
          customExecutionLeaseToken: leaseToken,
          customExecutionResult: null,
          customExecutionState: 'executing',
          updatedAt: now,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventionResolutions.id, resolution.id),
            this.resolutionOwnership(),
            eq(agentInterventionResolutions.status, 'resolving'),
          ),
        )
        .returning({ id: agentInterventionResolutions.id });
      return claimed
        ? { attempt, leaseExpiresAt, leaseToken, outcome: 'applied' }
        : { outcome: 'conflict' };
    });
  };

  /** Completes only the exact current fencing token and replays exact retries. */
  completeCustomExecution = async (
    params: CompleteAgentInterventionCustomExecutionParams,
    now = new Date(),
  ): Promise<AgentInterventionCustomExecutionCompletionResult> => {
    if (
      !UUID_PATTERN.test(params.resolutionRequestId) ||
      !HASH_PATTERN.test(params.inputHash) ||
      !UUID_PATTERN.test(params.leaseToken) ||
      !isCustomExecutionResult(params.result) ||
      Number.isNaN(now.getTime())
    ) {
      return { outcome: 'conflict' };
    }

    return this.db.transaction(async (tx) => {
      const [resolution] = await tx
        .select()
        .from(agentInterventionResolutions)
        .where(
          and(
            eq(agentInterventionResolutions.resolutionRequestId, params.resolutionRequestId),
            this.resolutionOwnership(),
          ),
        )
        .limit(1)
        .for('update');
      if (
        !resolution ||
        resolution.action.type !== 'submit_custom' ||
        resolution.customExecutionInputHash !== params.inputHash ||
        resolution.customExecutionLeaseToken !== params.leaseToken
      ) {
        return { outcome: 'conflict' };
      }

      if (resolution.customExecutionState === 'completed') {
        return resolution.customExecutionResult &&
          sameJson(resolution.customExecutionResult, params.result)
          ? { outcome: 'completed', result: resolution.customExecutionResult }
          : { outcome: 'conflict' };
      }
      if (resolution.status !== 'resolving' || resolution.customExecutionState !== 'executing') {
        return { outcome: 'conflict' };
      }

      const [completed] = await tx
        .update(agentInterventionResolutions)
        .set({
          customExecutionResult: params.result,
          customExecutionState: 'completed',
          updatedAt: now,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventionResolutions.id, resolution.id),
            this.resolutionOwnership(),
            eq(agentInterventionResolutions.customExecutionInputHash, params.inputHash),
            eq(agentInterventionResolutions.customExecutionLeaseToken, params.leaseToken),
            eq(agentInterventionResolutions.customExecutionState, 'executing'),
            eq(agentInterventionResolutions.status, 'resolving'),
          ),
        )
        .returning({ result: agentInterventionResolutions.customExecutionResult });
      return completed?.result
        ? { outcome: 'completed', result: completed.result }
        : { outcome: 'conflict' };
    });
  };

  /** Creates and seals a complete batch in one transaction. */
  createBatch = async (
    params: CreateAgentInterventionBatchParams,
  ): Promise<AgentInterventionItem[]> => {
    this.validateCreateBatch(params);
    return this.db.transaction((tx) => this.createBatchInTransaction(tx, params));
  };

  /**
   * Atomically replaces the still-pending remainder of a runtime batch after a
   * partial decision re-parks under a new operation. The new parked batch is
   * causal proof that the prior runtime continuation started, so an in-flight
   * winning resolution may be completed here before its published hook arrives.
   */
  createBatchWithSupersession = async (
    params: CreateAgentInterventionBatchWithSupersessionParams,
  ): Promise<AgentInterventionBatchSupersessionResult> => {
    const { batch, supersedes } = params;
    this.validateCreateBatch(batch);
    if (!supersedes) {
      return this.db.transaction(async (tx) => {
        const [ownedOperation] = await tx
          .select({ id: agentOperations.id, status: agentOperations.status })
          .from(agentOperations)
          .where(
            and(
              eq(agentOperations.id, batch.operationId),
              eq(agentOperations.userId, this.userId),
              this.workspaceId
                ? eq(agentOperations.workspaceId, this.workspaceId)
                : isNull(agentOperations.workspaceId),
            ),
          )
          .limit(1)
          .for('update');
        if (!ownedOperation) throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
        const existing = await tx
          .select({ id: agentInterventions.id })
          .from(agentInterventions)
          .where(
            and(
              eq(agentInterventions.operationId, batch.operationId),
              eq(agentInterventions.batchId, batch.batchId),
              this.ownership(),
            ),
          )
          .limit(1)
          .for('update');
        if (
          existing.length === 0 &&
          batch.source === 'runtime' &&
          ownedOperation.status !== 'waiting_for_human'
        ) {
          throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
        }
        const interventions = await this.createBatchInTransaction(tx, batch, ownedOperation.status);
        return {
          interventions,
          outcome: existing.length > 0 ? 'idempotent' : 'applied',
        };
      });
    }

    const supersededToolCallIds = uniqueSorted(supersedes.toolCallIds);
    const newToolCallIds = uniqueSorted(batch.items.map((item) => item.toolCallId));
    if (
      batch.source !== 'runtime' ||
      batch.operationId === supersedes.operationId ||
      batch.batchId === supersedes.batchId ||
      batch.activityKey === supersedes.activityKey ||
      supersededToolCallIds.length === 0 ||
      supersededToolCallIds.length !== supersedes.toolCallIds.length ||
      !sameJson(supersededToolCallIds, newToolCallIds)
    ) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    return this.db.transaction(async (tx) => {
      const operationIds = uniqueSorted([supersedes.operationId, batch.operationId]);
      const operations = await tx
        .select({
          agentId: agentOperations.agentId,
          appContext: agentOperations.appContext,
          chatGroupId: agentOperations.chatGroupId,
          id: agentOperations.id,
          status: agentOperations.status,
          taskId: agentOperations.taskId,
          threadId: agentOperations.threadId,
          topicId: agentOperations.topicId,
        })
        .from(agentOperations)
        .where(
          and(
            inArray(agentOperations.id, operationIds),
            eq(agentOperations.userId, this.userId),
            this.workspaceId
              ? eq(agentOperations.workspaceId, this.workspaceId)
              : isNull(agentOperations.workspaceId),
          ),
        )
        .orderBy(asc(agentOperations.id))
        .for('update');
      if (operations.length !== operationIds.length) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }
      const oldOperation = operations.find(({ id }) => id === supersedes.operationId);
      const newOperation = operations.find(({ id }) => id === batch.operationId);
      if (
        !oldOperation ||
        !newOperation ||
        !['waiting_for_human', 'done'].includes(oldOperation.status) ||
        !['waiting_for_human', 'done'].includes(newOperation.status) ||
        !this.hasSameOperationContext(oldOperation, newOperation)
      ) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }

      const lockedRows = await tx
        .select()
        .from(agentInterventions)
        .where(
          and(
            this.ownership(),
            or(
              and(
                eq(agentInterventions.operationId, supersedes.operationId),
                eq(agentInterventions.batchId, supersedes.batchId),
              ),
              and(
                eq(agentInterventions.operationId, batch.operationId),
                eq(agentInterventions.batchId, batch.batchId),
              ),
            ),
          ),
        )
        .orderBy(
          asc(agentInterventions.operationId),
          asc(agentInterventions.batchId),
          asc(agentInterventions.itemIndex),
          asc(agentInterventions.id),
        )
        .for('update');
      const oldRows = lockedRows
        .filter(
          (row) => row.operationId === supersedes.operationId && row.batchId === supersedes.batchId,
        )
        .sort((left, right) => left.itemIndex - right.itemIndex);
      const existingNewRows = lockedRows
        .filter((row) => row.operationId === batch.operationId && row.batchId === batch.batchId)
        .sort((left, right) => left.itemIndex - right.itemIndex);

      if (
        oldRows.length === 0 ||
        oldRows.some(
          (row, index) =>
            !row.sealed ||
            row.source !== 'runtime' ||
            row.activityKey !== supersedes.activityKey ||
            row.itemCount !== oldRows.length ||
            row.itemIndex !== index,
        )
      ) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }
      if (existingNewRows.length > 0 && !this.isSameCreateBatch(existingNewRows, batch)) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }

      const oldPendingRows = oldRows.filter((row) => row.status === 'pending');
      const activeOldRows = oldRows.filter((row) =>
        ['resolving', 'published'].includes(row.status),
      );
      const activeResolutionIds = uniqueSorted(
        activeOldRows.flatMap((row) => (row.resolutionId ? [row.resolutionId] : [])),
      );

      if (existingNewRows.length > 0) {
        const movedRows = oldRows.filter((row) => supersededToolCallIds.includes(row.toolCallId));
        if (
          oldPendingRows.length > 0 ||
          activeOldRows.length > 0 ||
          movedRows.length !== supersededToolCallIds.length ||
          movedRows.some((row) => row.status !== 'session_ended') ||
          oldOperation.status !== 'done'
        ) {
          throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
        }
        return {
          interventions: existingNewRows,
          outcome: 'idempotent',
          superseded: {
            activityKey: supersedes.activityKey,
            batchId: supersedes.batchId,
            interventions: oldRows,
            operationId: supersedes.operationId,
          },
        };
      }

      // A replacement may only be created while its new runtime operation is
      // still parked. The broader status allowance above exists solely so an
      // exact, already-created replacement can be replayed idempotently after
      // its continuation has advanced the operation to done.
      if (newOperation.status !== 'waiting_for_human') {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }

      if (
        !sameJson(
          uniqueSorted(oldPendingRows.map((row) => row.toolCallId)),
          supersededToolCallIds,
        ) ||
        activeResolutionIds.length > 1 ||
        activeOldRows.some((row) => !row.resolutionId)
      ) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }

      const now = new Date();
      if (activeResolutionIds.length === 1) {
        const [resolution] = await tx
          .select()
          .from(agentInterventionResolutions)
          .where(
            and(
              eq(agentInterventionResolutions.id, activeResolutionIds[0]),
              this.resolutionOwnership(),
            ),
          )
          .limit(1)
          .for('update');
        const activeIds = uniqueSorted(activeOldRows.map((row) => row.id));
        if (
          !resolution ||
          resolution.source !== 'runtime' ||
          resolution.operationId !== supersedes.operationId ||
          resolution.batchId !== supersedes.batchId ||
          !['resolving', 'published'].includes(resolution.status) ||
          resolution.action.type === 'stop' ||
          resolution.action.type === 'cancel_interaction' ||
          !sameJson(uniqueSorted(resolution.selectedInterventionIds), activeIds)
        ) {
          throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
        }
        await tx
          .update(agentInterventionResolutions)
          .set({
            continuationStartedAt: now,
            publishedAt: resolution.publishedAt ?? now,
            status: 'completed',
            terminalAt: now,
            updatedAt: now,
            version: sql`${agentInterventionResolutions.version} + 1`,
          })
          .where(eq(agentInterventionResolutions.id, resolution.id));
        await tx
          .update(agentInterventions)
          .set({
            resolvedAt: now,
            status: terminalStatusForAction(resolution.action),
            updatedAt: now,
            version: sql`${agentInterventions.version} + 1`,
          })
          .where(
            and(
              eq(agentInterventions.resolutionId, resolution.id),
              inArray(agentInterventions.status, ['resolving', 'published']),
            ),
          );
      }

      const movedRows = await tx
        .update(agentInterventions)
        .set({
          resolvedAt: now,
          status: 'session_ended',
          updatedAt: now,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventions.operationId, supersedes.operationId),
            eq(agentInterventions.batchId, supersedes.batchId),
            eq(agentInterventions.status, 'pending'),
            inArray(agentInterventions.toolCallId, supersededToolCallIds),
            this.ownership(),
          ),
        )
        .returning();
      if (movedRows.length !== supersededToolCallIds.length) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }

      await tx
        .update(agentOperations)
        .set({ completedAt: now, completionReason: 'done', status: 'done' })
        .where(
          and(
            eq(agentOperations.id, supersedes.operationId),
            eq(agentOperations.status, 'waiting_for_human'),
            eq(agentOperations.userId, this.userId),
            this.workspaceId
              ? eq(agentOperations.workspaceId, this.workspaceId)
              : isNull(agentOperations.workspaceId),
          ),
        );

      const interventions = await this.createBatchInTransaction(tx, batch, newOperation.status);
      const supersededRows = await tx
        .select()
        .from(agentInterventions)
        .where(
          and(
            eq(agentInterventions.operationId, supersedes.operationId),
            eq(agentInterventions.batchId, supersedes.batchId),
            this.ownership(),
          ),
        )
        .orderBy(asc(agentInterventions.itemIndex));
      return {
        interventions,
        outcome: 'applied',
        superseded: {
          activityKey: supersedes.activityKey,
          batchId: supersedes.batchId,
          interventions: supersededRows,
          operationId: supersedes.operationId,
        },
      };
    });
  };

  findById = async (id: string): Promise<AgentInterventionItem | undefined> => {
    if (!UUID_PATTERN.test(id)) return undefined;
    const row = await this.reload(id);
    return row && this.withLazyTimeout(row);
  };

  /** Owner-only cold-start lookup used before restoring a workspace header. */
  findByIdForOwner = async (id: string): Promise<AgentInterventionItem | undefined> => {
    if (!UUID_PATTERN.test(id)) return undefined;
    const [row] = await this.db
      .select()
      .from(agentInterventions)
      .where(and(eq(agentInterventions.id, id), this.ownerOnly()))
      .limit(1);
    return row && this.withOwnerLazyTimeout(row);
  };

  /** Legacy owner-auth token lookup. Workspace collaborators use the system locator + ACL. */
  findByReviewTokenHash = async (
    reviewTokenHash: string,
  ): Promise<AgentInterventionItem | undefined> => {
    if (!HASH_PATTERN.test(reviewTokenHash)) return undefined;
    const [row] = await this.db
      .select()
      .from(agentInterventions)
      .where(and(eq(agentInterventions.reviewTokenHash, reviewTokenHash), this.ownerOnly()))
      .limit(1);
    return row && this.withOwnerLazyTimeout(row);
  };

  findBatch = async (
    operationId: string,
    batchId: string,
  ): Promise<AgentInterventionBatchState> => {
    const rows = await this.reloadBatch(operationId, batchId);
    if (rows.length === 0) return { interventions: [], resolutions: [] };
    if (
      rows.some(
        (row) =>
          ['pending', 'resolving', 'published'].includes(row.status) &&
          row.deadline.getTime() <= Date.now(),
      )
    ) {
      await this.markBatchTerminal(operationId, batchId, 'timed_out');
    }
    const interventions = await this.reloadBatch(operationId, batchId);
    const resolutionIds = uniqueSorted(
      interventions.flatMap((row) => (row.resolutionId ? [row.resolutionId] : [])),
    );
    const resolutions =
      resolutionIds.length === 0
        ? []
        : await this.db
            .select(publicResolutionColumns)
            .from(agentInterventionResolutions)
            .where(
              and(
                inArray(agentInterventionResolutions.id, resolutionIds),
                this.resolutionOwnership(),
              ),
            );
    return { interventions, resolutions };
  };

  /**
   * Atomically validates a complete sealed Review snapshot and claims one,
   * selected, or all pending items. The resolving actor is explicit and may be
   * different from the operation owner after the service has applied ACL.
   */
  claimBatch = async (
    params: ClaimAgentInterventionBatchParams,
  ): Promise<AgentInterventionBatchMutationResult> => {
    if (!UUID_PATTERN.test(params.resolutionRequestId)) {
      throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
    }
    if (!isCanonicalJsonSafe(params.action)) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }

    const existingRequest = await this.findResolutionByRequestId(params.resolutionRequestId);
    if (existingRequest) return this.resolveIdempotentClaim(existingRequest, params);

    try {
      return await this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(agentInterventions)
          .where(
            and(
              eq(agentInterventions.operationId, params.operationId),
              eq(agentInterventions.batchId, params.batchId),
              this.ownership(),
            ),
          )
          .orderBy(asc(agentInterventions.itemIndex))
          .for('update');
        if (rows.length === 0) return { outcome: 'not_found' };

        const now = new Date();
        const overdue = rows.filter(
          (row) =>
            ['pending', 'resolving', 'published'].includes(row.status) &&
            row.deadline.getTime() <= now.getTime(),
        );
        if (overdue.length > 0) {
          const terminalRows = await this.markRowsTerminalInTransaction(tx, rows, 'timed_out', now);
          return { interventions: terminalRows, outcome: 'conflict' };
        }

        const batchIds = rows.map((row) => row.id);
        if (!this.hasValidSealedSnapshot(rows, params)) {
          return { interventions: rows, outcome: 'conflict' };
        }

        const selectedIds = uniqueSorted(params.selectedInterventionIds);
        // Stopping an operation settles only the callbacks that are still pending.
        // The caller still supplies the complete sealed-batch snapshot for CAS, but
        // already terminal siblings must remain immutable.
        const targetIds =
          params.action.type === 'stop'
            ? selectedIds
            : params.scope === 'all'
              ? [...batchIds].sort()
              : selectedIds;
        const targets = rows.filter((row) => targetIds.includes(row.id));
        if (!this.hasValidSelection(rows, targets, params, selectedIds)) {
          return { interventions: rows, outcome: 'conflict' };
        }
        if (targets.some((row) => row.status !== 'pending')) {
          return { interventions: rows, outcome: 'conflict' };
        }

        this.validateAction(targets, params);

        const argumentEffect = await this.applyArgumentEffect(tx, targets, params.action);

        let rememberToolKey: null | string = null;
        let rememberEffectStatus: 'applied' | 'retained' | null = null;
        if (params.action.type === 'approve_remember') {
          const remember = await this.applyRememberEffect(tx, params.actorId, targets[0]);
          rememberToolKey = remember.toolKey;
          rememberEffectStatus = remember.status;
        }

        const [resolution] = await tx
          .insert(agentInterventionResolutions)
          .values({
            action: params.action,
            argumentEffectStatus: argumentEffect ? 'applied' : null,
            actorId: params.actorId,
            batchId: params.batchId,
            customExecutionAttempt: params.action.type === 'submit_custom' ? 0 : null,
            customExecutionState: params.action.type === 'submit_custom' ? 'pending' : null,
            expectedItemCount: params.expectedItemCount,
            expectedRequestRevisionHashes: params.expectedRequestRevisionHashes,
            expectedVersions: params.expectedVersions,
            operationId: rows[0].operationId,
            editedArguments: argumentEffect?.editedArguments,
            editedRequestRevisionHash: argumentEffect?.editedRequestRevisionHash,
            originalArguments: argumentEffect?.originalArguments,
            originalRequestRevisionHash: argumentEffect?.originalRequestRevisionHash,
            rememberEffectStatus,
            rememberToolKey,
            resolutionRequestId: params.resolutionRequestId,
            scope: params.scope,
            selectedInterventionIds: targetIds,
            source: rows[0].source,
            userId: this.userId,
            workspaceId: this.workspaceId ?? null,
          })
          .returning();

        const claimed = await tx
          .update(agentInterventions)
          .set({
            requestRevisionHash: argumentEffect?.editedRequestRevisionHash,
            resolutionId: resolution.id,
            resolvingAt: now,
            status: 'resolving',
            updatedAt: now,
            version: sql`${agentInterventions.version} + 1`,
          })
          .where(
            and(
              inArray(agentInterventions.id, targetIds),
              this.ownership(),
              eq(agentInterventions.status, 'pending'),
              gt(agentInterventions.deadline, now),
            ),
          )
          .returning();
        if (claimed.length !== targetIds.length) throw new Error(AGENT_INTERVENTION_INVALID_BATCH);

        const updatedRows = rows.map((row) => claimed.find((item) => item.id === row.id) ?? row);
        return { interventions: updatedRows, outcome: 'applied', resolution };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findResolutionByRequestId(params.resolutionRequestId);
        if (existing) return this.resolveIdempotentClaim(existing, params);
        throw new Error(AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED, { cause: error });
      }
      throw error;
    }
  };

  markResolutionPublished = async (
    resolutionRequestId: string,
    publishedAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.transitionResolution(resolutionRequestId, async (tx, resolution, rows) => {
      if (resolution.status === 'published' || resolution.status === 'completed') {
        return { interventions: rows, outcome: 'idempotent', resolution };
      }
      if (resolution.status !== 'resolving') {
        return { interventions: rows, outcome: 'conflict', resolution };
      }

      const [updatedResolution] = await tx
        .update(agentInterventionResolutions)
        .set({
          publishedAt,
          status: 'published',
          updatedAt: publishedAt,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventionResolutions.id, resolution.id),
            eq(agentInterventionResolutions.status, 'resolving'),
          ),
        )
        .returning();
      const updatedRows = await tx
        .update(agentInterventions)
        .set({
          publishedAt,
          status: 'published',
          updatedAt: publishedAt,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventions.resolutionId, resolution.id),
            eq(agentInterventions.status, 'resolving'),
          ),
        )
        .returning();
      return { interventions: updatedRows, outcome: 'applied', resolution: updatedResolution };
    });

  /** Publish failed before consumption; conditionally reopens only this claim. */
  rollbackResolution = async (
    resolutionRequestId: string,
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.transitionResolution(resolutionRequestId, async (tx, resolution, rows) => {
      if (resolution.status === 'rolled_back') {
        return { interventions: rows, outcome: 'idempotent', resolution };
      }
      if (resolution.status !== 'resolving') {
        return { interventions: rows, outcome: 'conflict', resolution };
      }
      if (
        resolution.action.type === 'submit_custom' &&
        resolution.customExecutionState !== null &&
        resolution.customExecutionState !== 'pending'
      ) {
        return { interventions: rows, outcome: 'conflict', resolution };
      }

      const now = new Date();
      const argumentRollback = await this.rollbackArgumentEffect(tx, resolution, rows);
      const rememberEffectStatus = await this.rollbackRememberEffect(tx, resolution);
      const [updatedResolution] = await tx
        .update(agentInterventionResolutions)
        .set({
          argumentEffectStatus: argumentRollback.status,
          rememberEffectStatus,
          rolledBackAt: now,
          status: 'rolled_back',
          updatedAt: now,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(eq(agentInterventionResolutions.id, resolution.id))
        .returning();

      const updatedRows = await tx
        .update(agentInterventions)
        .set({
          requestRevisionHash: argumentRollback.requestRevisionHash,
          resolutionId: null,
          resolvingAt: null,
          status: 'pending',
          updatedAt: now,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventions.resolutionId, resolution.id),
            eq(agentInterventions.status, 'resolving'),
            gt(agentInterventions.deadline, now),
          ),
        )
        .returning();
      const expiredRows = await tx
        .update(agentInterventions)
        .set({
          requestRevisionHash: argumentRollback.requestRevisionHash,
          resolutionId: null,
          resolvedAt: now,
          resolvingAt: null,
          status: 'timed_out',
          updatedAt: now,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventions.resolutionId, resolution.id),
            eq(agentInterventions.status, 'resolving'),
            lte(agentInterventions.deadline, now),
          ),
        )
        .returning();
      return {
        interventions: [...updatedRows, ...expiredRows].sort(
          (left, right) => left.itemIndex - right.itemIndex,
        ),
        outcome: 'applied',
        resolution: updatedResolution,
      };
    });

  /** Runtime rows become terminal once the continuation has durably started. */
  completeRuntimeResolution = async (
    resolutionRequestId: string,
    continuationStartedAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.completeResolution(resolutionRequestId, 'runtime', continuationStartedAt);

  /** Heterogeneous rows become terminal only after the matching producer ACK. */
  acknowledgeProducerResolution = async (
    resolutionRequestId: string,
    producerAckAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.completeResolution(resolutionRequestId, 'heterogeneous', producerAckAt);

  /** Timeout/session teardown of every still-open item in one sealed batch. */
  markBatchTerminal = async (
    operationId: string,
    batchId: string,
    status: 'session_ended' | 'timed_out',
    at = new Date(),
  ): Promise<AgentInterventionItem[]> =>
    this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(agentInterventions)
        .where(
          and(
            eq(agentInterventions.operationId, operationId),
            eq(agentInterventions.batchId, batchId),
            this.ownership(),
          ),
        )
        .for('update');
      if (rows.length === 0) return [];
      if (status === 'timed_out' && rows.every((row) => row.deadline.getTime() > at.getTime())) {
        return rows;
      }

      const openRows = rows.filter((row) =>
        ['pending', 'resolving', 'published'].includes(row.status),
      );
      if (openRows.length === 0) return rows;
      return this.markRowsTerminalInTransaction(tx, rows, status, at);
    });

  /** Late heterogeneous ACK is audited without overwriting timeout/session outcome. */
  recordProducerAck = async (
    resolutionRequestId: string,
    producerAckAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.transitionResolution(resolutionRequestId, async (tx, resolution, rows) => {
      if (resolution.source !== 'heterogeneous') {
        throw new Error(AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH);
      }
      if (resolution.producerAckAt) {
        return { interventions: rows, outcome: 'idempotent', resolution };
      }
      if (!['timed_out', 'session_ended'].includes(resolution.status)) {
        return { interventions: rows, outcome: 'conflict', resolution };
      }
      const [updatedResolution] = await tx
        .update(agentInterventionResolutions)
        .set({
          producerAckAt,
          updatedAt: producerAckAt,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(eq(agentInterventionResolutions.id, resolution.id))
        .returning();
      const updatedRows = await tx
        .update(agentInterventions)
        .set({
          producerAckAt,
          updatedAt: producerAckAt,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(eq(agentInterventions.resolutionId, resolution.id))
        .returning();
      return { interventions: updatedRows, outcome: 'applied', resolution: updatedResolution };
    });

  findResolutionByRequestId = async (
    resolutionRequestId: string,
  ): Promise<AgentInterventionResolutionItem | undefined> => {
    if (!UUID_PATTERN.test(resolutionRequestId)) return undefined;
    const [row] = await this.db
      .select()
      .from(agentInterventionResolutions)
      .where(
        and(
          eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId),
          this.resolutionOwnership(),
        ),
      )
      .limit(1);
    return row;
  };

  private markRowsTerminalInTransaction = async (
    tx: Transaction,
    rows: AgentInterventionItem[],
    status: 'session_ended' | 'timed_out',
    at: Date,
  ): Promise<AgentInterventionItem[]> => {
    const openRows = rows.filter((row) =>
      ['pending', 'resolving', 'published'].includes(row.status),
    );
    if (openRows.length === 0) return rows;
    const resolutionIds = uniqueSorted(
      openRows.flatMap((row) => (row.resolutionId ? [row.resolutionId] : [])),
    );
    const protectedResolutionIds = new Set<string>();
    if (resolutionIds.length > 0) {
      const resolutions = await tx
        .select({
          customExecutionState: agentInterventionResolutions.customExecutionState,
          id: agentInterventionResolutions.id,
        })
        .from(agentInterventionResolutions)
        .where(
          and(inArray(agentInterventionResolutions.id, resolutionIds), this.resolutionOwnership()),
        )
        .orderBy(asc(agentInterventionResolutions.id))
        .for('update');
      for (const resolution of resolutions) {
        if (['executing', 'completed'].includes(resolution.customExecutionState ?? '')) {
          protectedResolutionIds.add(resolution.id);
        }
      }
      const terminalResolutionIds = resolutionIds.filter(
        (resolutionId) => !protectedResolutionIds.has(resolutionId),
      );
      if (terminalResolutionIds.length > 0) {
        await tx
          .update(agentInterventionResolutions)
          .set({
            status,
            terminalAt: at,
            updatedAt: at,
            version: sql`${agentInterventionResolutions.version} + 1`,
          })
          .where(
            and(
              inArray(agentInterventionResolutions.id, terminalResolutionIds),
              inArray(agentInterventionResolutions.status, ['resolving', 'published']),
            ),
          );
      }
    }
    const terminalRows = openRows.filter(
      (row) => !row.resolutionId || !protectedResolutionIds.has(row.resolutionId),
    );
    if (terminalRows.length === 0) return rows;
    const updated = await tx
      .update(agentInterventions)
      .set({
        resolvedAt: at,
        status,
        updatedAt: at,
        version: sql`${agentInterventions.version} + 1`,
      })
      .where(
        inArray(
          agentInterventions.id,
          terminalRows.map((row) => row.id),
        ),
      )
      .returning();
    return rows.map((row) => updated.find((item) => item.id === row.id) ?? row);
  };

  private createBatchInTransaction = async (
    tx: Transaction,
    params: CreateAgentInterventionBatchParams,
    lockedOperationStatus?: AgentInterventionOperationIdentity['status'],
  ): Promise<AgentInterventionItem[]> => {
    let operationStatus = lockedOperationStatus;
    if (operationStatus === undefined) {
      const [ownedOperation] = await tx
        .select({ id: agentOperations.id, status: agentOperations.status })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.id, params.operationId),
            eq(agentOperations.userId, this.userId),
            this.workspaceId
              ? eq(agentOperations.workspaceId, this.workspaceId)
              : isNull(agentOperations.workspaceId),
          ),
        )
        .limit(1)
        .for('update');
      if (!ownedOperation) throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      operationStatus = ownedOperation.status;
    }

    const existing = await tx
      .select()
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.operationId, params.operationId),
          eq(agentInterventions.batchId, params.batchId),
          this.ownership(),
        ),
      )
      .orderBy(asc(agentInterventions.itemIndex))
      .for('update');

    if (existing.length > 0) {
      if (!this.isSameCreateBatch(existing, params)) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }
      return existing;
    }
    if (params.source === 'runtime' && operationStatus !== 'waiting_for_human') {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    try {
      return await tx
        .insert(agentInterventions)
        .values(
          params.items.map((item, itemIndex) => ({
            ...item,
            activityKey: params.activityKey,
            allowedActions: [...item.allowedActions],
            approvalMode: params.approvalMode ?? null,
            batchId: params.batchId,
            deadline: params.deadline,
            itemCount: params.items.length,
            itemIndex,
            operationId: params.operationId,
            provider: item.provider ?? params.provider ?? null,
            reviewContext: normalizeDtoJson(item.reviewContext),
            risk: item.risk === undefined ? null : normalizeDtoJson(item.risk),
            sanitizedRequest: normalizeDtoJson(item.sanitizedRequest),
            sealed: true,
            source: params.source,
            stepIndex: params.stepIndex,
            systemActionEligibility: params.systemActionEligibility,
            userId: this.userId,
            workspaceId: this.workspaceId ?? null,
          })),
        )
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT, { cause: error });
      }
      throw error;
    }
  };

  private isSameCreateBatch = (
    existing: AgentInterventionItem[],
    params: CreateAgentInterventionBatchParams,
  ): boolean =>
    existing.length === params.items.length &&
    existing.every((row, index) => {
      const item = params.items[index];
      return (
        row.activityKey === params.activityKey &&
        row.approvalMode === (params.approvalMode ?? null) &&
        row.batchId === params.batchId &&
        row.canonicalToolKey === (item.canonicalToolKey ?? null) &&
        row.deadline.getTime() === params.deadline.getTime() &&
        row.interactionKind === item.interactionKind &&
        row.itemCount === params.items.length &&
        row.itemIndex === index &&
        row.provider === (item.provider ?? params.provider ?? null) &&
        row.requestRevisionHash === item.requestRevisionHash &&
        row.reviewTokenHash === item.reviewTokenHash &&
        row.sealed &&
        row.source === params.source &&
        row.stepIndex === params.stepIndex &&
        row.surface === item.surface &&
        row.systemActionEligibility === params.systemActionEligibility &&
        row.toolCallId === item.toolCallId &&
        row.toolMessageId === (item.toolMessageId ?? null) &&
        sameJson(uniqueSorted(row.allowedActions), uniqueSorted(item.allowedActions)) &&
        sameDtoJson(row.reviewContext, item.reviewContext) &&
        sameDtoJson(row.risk, item.risk ?? null) &&
        sameDtoJson(row.sanitizedRequest, item.sanitizedRequest)
      );
    });

  private hasSameOperationContext = (
    left: AgentInterventionOperationIdentity,
    right: AgentInterventionOperationIdentity,
  ): boolean => {
    const leftContext = asRecord(left.appContext);
    const rightContext = asRecord(right.appContext);
    return (
      left.agentId === right.agentId &&
      left.chatGroupId === right.chatGroupId &&
      left.taskId === right.taskId &&
      left.threadId === right.threadId &&
      left.topicId === right.topicId &&
      sameJson(
        {
          documentId: leftContext.documentId ?? null,
          groupId: leftContext.groupId ?? null,
          scope: leftContext.scope ?? null,
          sessionId: leftContext.sessionId ?? null,
        },
        {
          documentId: rightContext.documentId ?? null,
          groupId: rightContext.groupId ?? null,
          scope: rightContext.scope ?? null,
          sessionId: rightContext.sessionId ?? null,
        },
      )
    );
  };

  private validateCreateBatch(params: CreateAgentInterventionBatchParams) {
    if (
      !params.batchId ||
      !params.activityKey ||
      params.items.length === 0 ||
      params.stepIndex < 0
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
    }
    if (
      params.systemActionEligibility === 'safe_single_binary' &&
      (params.items.length !== 1 ||
        params.source !== 'runtime' ||
        params.items[0].surface !== 'binary')
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
    }
    const toolCallIds = new Set<string>();
    const reviewHashes = new Set<string>();
    for (const item of params.items) {
      if (!HASH_PATTERN.test(item.reviewTokenHash)) {
        throw new Error(AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH);
      }
      if (!HASH_PATTERN.test(item.requestRevisionHash)) {
        throw new Error(AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH);
      }
      if (
        !item.toolCallId ||
        item.allowedActions.length === 0 ||
        uniqueSorted(item.allowedActions).length !== item.allowedActions.length ||
        toolCallIds.has(item.toolCallId) ||
        reviewHashes.has(item.reviewTokenHash)
      ) {
        throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
      }
      const unsafeRequest = item.sanitizedRequest as AgentInterventionSanitizedRequest &
        Record<string, unknown>;
      if (
        !isCanonicalDtoJsonSafe(item.reviewContext) ||
        !isCanonicalDtoJsonSafe(item.risk ?? null) ||
        !isCanonicalDtoJsonSafe(item.sanitizedRequest) ||
        'arguments' in unsafeRequest ||
        'rawArguments' in unsafeRequest ||
        'metadata' in unsafeRequest ||
        !hasValidCustomDetail(item.sanitizedRequest)
      ) {
        throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
      }
      const hasQuestionFreeform =
        item.sanitizedRequest.answerPolicy?.allowFreeform === true ||
        item.sanitizedRequest.answerPolicy?.allowSupplement === true ||
        item.sanitizedRequest.questions?.some((question) => question.allowCustomAnswer) === true;
      if (hasQuestionFreeform && item.interactionKind !== 'question') {
        throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
      }
      if (item.allowedActions.includes('approve_remember') && !item.canonicalToolKey) {
        throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
      }
      if (params.source === 'heterogeneous' && !(item.provider ?? params.provider)) {
        throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
      }
      toolCallIds.add(item.toolCallId);
      reviewHashes.add(item.reviewTokenHash);
    }
  }

  private hasValidSealedSnapshot(
    rows: AgentInterventionItem[],
    params: ClaimAgentInterventionBatchParams,
  ): boolean {
    const ids = rows.map((row) => row.id);
    if (
      rows.length !== params.expectedItemCount ||
      rows.some(
        (row, index) => !row.sealed || row.itemCount !== rows.length || row.itemIndex !== index,
      ) ||
      !hasExactKeys(params.expectedVersions, ids) ||
      !hasExactKeys(params.expectedRequestRevisionHashes, ids)
    ) {
      return false;
    }
    return rows.every(
      (row) =>
        params.expectedVersions[row.id] === row.version &&
        params.expectedRequestRevisionHashes[row.id] === row.requestRevisionHash,
    );
  }

  private hasValidSelection(
    rows: AgentInterventionItem[],
    targets: AgentInterventionItem[],
    params: ClaimAgentInterventionBatchParams,
    selectedIds: string[],
  ): boolean {
    if (selectedIds.length === 0 || targets.length !== selectedIds.length) return false;
    if (params.scope === 'single' && selectedIds.length !== 1) return false;
    if (params.action.type === 'stop') {
      // Let validateAction surface an invalid stop scope as a contract error,
      // rather than disguising it as a stale-snapshot conflict.
      if (params.scope !== 'all') return true;
      // A published/resolving sibling already won a competing decision and must
      // finish before an operation-wide stop can safely claim the remainder.
      if (rows.some((row) => row.status === 'resolving' || row.status === 'published'))
        return false;
      const pendingIds = rows
        .filter((row) => row.status === 'pending')
        .map((row) => row.id)
        .sort();
      return sameJson(pendingIds, selectedIds);
    }
    if (params.scope === 'all') {
      const batchIds = rows.map((row) => row.id).sort();
      return sameJson(batchIds, selectedIds);
    }
    return true;
  }

  private validateAction(
    targets: AgentInterventionItem[],
    params: ClaimAgentInterventionBatchParams,
  ) {
    const capability = actionCapability(params.action);
    if (targets.some((row) => !row.allowedActions.includes(capability))) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    if (
      (params.action.type === 'approve' || params.action.type === 'approve_remember') &&
      params.action.editedArguments &&
      (params.scope !== 'single' ||
        targets.length !== 1 ||
        !targets[0].allowedActions.includes('edit_arguments'))
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    if (
      params.action.type === 'approve_remember' &&
      (params.scope !== 'single' ||
        targets.length !== 1 ||
        params.actorId !== this.userId ||
        !targets[0].canonicalToolKey)
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    if (
      params.action.type === 'select_provider_option' &&
      (targets.length !== 1 ||
        !providerOptionIds(targets[0].sanitizedRequest).has(params.action.optionId))
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    if (
      params.action.type === 'submit_answers' &&
      (targets.length !== 1 || !hasValidAnswers(targets[0].sanitizedRequest, params.action.answers))
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    if (
      params.action.type === 'submit_custom' &&
      (targets.length !== 1 ||
        params.action.expectedRevisionHash !== targets[0].requestRevisionHash ||
        !hasValidCustomResult(targets[0].sanitizedRequest, params.action.result))
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    if (
      params.action.type === 'stop' &&
      (params.action.haltScope !== 'operation' || params.scope !== 'all')
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
  }

  private applyArgumentEffect = async (
    tx: Transaction,
    targets: AgentInterventionItem[],
    action: AgentInterventionResolutionAction,
  ): Promise<
    | {
        editedArguments: string;
        editedRequestRevisionHash: string;
        originalArguments: string;
        originalRequestRevisionHash: string;
      }
    | undefined
  > => {
    if (action.type !== 'approve' && action.type !== 'approve_remember') return undefined;

    const targetMessageIds = targets.map((target) => target.toolMessageId);
    if (targetMessageIds.some((id): id is null => !id)) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    const pluginRows = await tx
      .select({
        arguments: messagePlugins.arguments,
        id: messagePlugins.id,
        parentId: messages.parentId,
        toolCallId: messagePlugins.toolCallId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messages.id, messagePlugins.id))
      .where(
        and(
          inArray(messagePlugins.id, targetMessageIds as string[]),
          eq(messagePlugins.userId, this.userId),
          this.workspaceId
            ? eq(messagePlugins.workspaceId, this.workspaceId)
            : isNull(messagePlugins.workspaceId),
        ),
      )
      .orderBy(asc(messagePlugins.id))
      .for('update');
    if (pluginRows.length !== targets.length) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    for (const target of targets) {
      const plugin = pluginRows.find((row) => row.id === target.toolMessageId);
      if (
        !plugin ||
        plugin.toolCallId !== target.toolCallId ||
        plugin.arguments === null ||
        hashAgentInterventionRequestRevision(plugin.arguments) !== target.requestRevisionHash
      ) {
        throw new Error(AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH);
      }
    }

    if (!action.editedArguments) return undefined;
    const target = targets[0];
    const plugin = pluginRows[0];
    if (!plugin.parentId || plugin.id !== target.toolMessageId) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    const [parent] = await tx
      .select({ id: messages.id, tools: messages.tools })
      .from(messages)
      .where(
        and(
          eq(messages.id, plugin.parentId),
          eq(messages.userId, this.userId),
          this.workspaceId
            ? eq(messages.workspaceId, this.workspaceId)
            : isNull(messages.workspaceId),
        ),
      )
      .limit(1)
      .for('update');
    if (!parent?.tools) throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);

    const originalArguments = plugin.arguments as string;
    const editedArguments = canonicalJson(action.editedArguments);
    const originalRequestRevisionHash = hashAgentInterventionRequestRevision(originalArguments);
    const editedRequestRevisionHash = hashAgentInterventionRequestRevision(editedArguments);
    const tools = parent.tools as ChatToolPayload[];
    let toolFound = false;
    const updatedTools = tools.map((tool) => {
      if (tool.id !== target.toolCallId) return tool;
      toolFound = true;
      return { ...tool, arguments: editedArguments };
    });
    if (!toolFound) throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);

    await tx
      .update(messagePlugins)
      .set({ arguments: editedArguments })
      .where(
        and(eq(messagePlugins.id, plugin.id), eq(messagePlugins.arguments, originalArguments)),
      );
    await tx.update(messages).set({ tools: updatedTools }).where(eq(messages.id, parent.id));

    return {
      editedArguments,
      editedRequestRevisionHash,
      originalArguments,
      originalRequestRevisionHash,
    };
  };

  private applyRememberEffect = async (
    tx: Transaction,
    actorId: string,
    target: AgentInterventionItem,
  ): Promise<{ status: 'applied' | 'retained'; toolKey: string }> => {
    if (actorId !== this.userId || !target.canonicalToolKey) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    await tx
      .insert(userSettings)
      .values({ id: this.userId, tool: {} })
      .onConflictDoNothing({ target: userSettings.id });
    const [settings] = await tx
      .select({ tool: userSettings.tool })
      .from(userSettings)
      .where(eq(userSettings.id, this.userId))
      .limit(1)
      .for('update');

    const tool = asRecord(settings?.tool);
    const humanIntervention = asRecord(tool.humanIntervention);
    const allowList = Array.isArray(humanIntervention.allowList)
      ? humanIntervention.allowList.filter((item): item is string => typeof item === 'string')
      : [];
    const existed = allowList.includes(target.canonicalToolKey);
    if (!existed) {
      await tx
        .update(userSettings)
        .set({
          tool: {
            ...tool,
            humanIntervention: {
              ...humanIntervention,
              allowList: [...allowList, target.canonicalToolKey],
            },
          },
        })
        .where(eq(userSettings.id, this.userId));
    }
    return { status: existed ? 'retained' : 'applied', toolKey: target.canonicalToolKey };
  };

  private rollbackArgumentEffect = async (
    tx: Transaction,
    resolution: AgentInterventionResolutionItem,
    rows: AgentInterventionItem[],
  ): Promise<{
    requestRevisionHash?: string;
    status: 'applied' | 'retained' | 'rolled_back' | null;
  }> => {
    if (resolution.argumentEffectStatus !== 'applied') {
      return { status: resolution.argumentEffectStatus };
    }
    const row = rows[0];
    if (
      rows.length !== 1 ||
      !row?.toolMessageId ||
      !resolution.originalArguments ||
      !resolution.editedArguments ||
      !resolution.originalRequestRevisionHash ||
      !resolution.editedRequestRevisionHash
    ) {
      return { status: 'retained' };
    }

    const [plugin] = await tx
      .select({
        arguments: messagePlugins.arguments,
        id: messagePlugins.id,
        parentId: messages.parentId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messages.id, messagePlugins.id))
      .where(
        and(
          eq(messagePlugins.id, row.toolMessageId),
          eq(messagePlugins.userId, this.userId),
          this.workspaceId
            ? eq(messagePlugins.workspaceId, this.workspaceId)
            : isNull(messagePlugins.workspaceId),
        ),
      )
      .limit(1)
      .for('update');
    if (!plugin?.arguments) return { status: 'retained' };

    const currentHash = hashAgentInterventionRequestRevision(plugin.arguments);
    if (
      plugin.arguments !== resolution.editedArguments ||
      currentHash !== resolution.editedRequestRevisionHash ||
      row.requestRevisionHash !== resolution.editedRequestRevisionHash ||
      !plugin.parentId
    ) {
      return { requestRevisionHash: currentHash, status: 'retained' };
    }

    const [parent] = await tx
      .select({ id: messages.id, tools: messages.tools })
      .from(messages)
      .where(
        and(
          eq(messages.id, plugin.parentId),
          eq(messages.userId, this.userId),
          this.workspaceId
            ? eq(messages.workspaceId, this.workspaceId)
            : isNull(messages.workspaceId),
        ),
      )
      .limit(1)
      .for('update');
    if (!parent?.tools) return { requestRevisionHash: currentHash, status: 'retained' };

    let toolFound = false;
    const updatedTools = (parent.tools as ChatToolPayload[]).map((tool) => {
      if (tool.id !== row.toolCallId || tool.arguments !== resolution.editedArguments) return tool;
      toolFound = true;
      return { ...tool, arguments: resolution.originalArguments as string };
    });
    if (!toolFound) return { requestRevisionHash: currentHash, status: 'retained' };

    const restored = await tx
      .update(messagePlugins)
      .set({ arguments: resolution.originalArguments })
      .where(
        and(
          eq(messagePlugins.id, plugin.id),
          eq(messagePlugins.arguments, resolution.editedArguments),
        ),
      )
      .returning({ id: messagePlugins.id });
    if (restored.length !== 1) {
      return { requestRevisionHash: currentHash, status: 'retained' };
    }
    await tx.update(messages).set({ tools: updatedTools }).where(eq(messages.id, parent.id));
    return {
      requestRevisionHash: resolution.originalRequestRevisionHash,
      status: 'rolled_back',
    };
  };

  private rollbackRememberEffect = async (
    tx: Transaction,
    resolution: AgentInterventionResolutionItem,
  ): Promise<'applied' | 'retained' | 'rolled_back' | null> => {
    if (!resolution.rememberToolKey || resolution.rememberEffectStatus !== 'applied') {
      return resolution.rememberEffectStatus;
    }

    // Serialize with approve_remember claims on the same user settings row.
    // A concurrent claim inserts its durable resolution before releasing this
    // lock, so the dependency check below cannot miss an in-flight retain.
    const [settings] = await tx
      .select({ tool: userSettings.tool })
      .from(userSettings)
      .where(eq(userSettings.id, this.userId))
      .limit(1)
      .for('update');
    const [dependent] = await tx
      .select({ id: agentInterventionResolutions.id })
      .from(agentInterventionResolutions)
      .where(
        and(
          eq(agentInterventionResolutions.userId, this.userId),
          eq(agentInterventionResolutions.rememberToolKey, resolution.rememberToolKey),
          ne(agentInterventionResolutions.id, resolution.id),
          inArray(agentInterventionResolutions.status, [
            'resolving',
            'published',
            'acknowledged',
            'completed',
          ]),
        ),
      )
      .limit(1);
    if (dependent) return 'retained';
    if (!settings) return 'rolled_back';
    const tool = asRecord(settings.tool);
    const humanIntervention = asRecord(tool.humanIntervention);
    const allowList = Array.isArray(humanIntervention.allowList)
      ? humanIntervention.allowList.filter((item): item is string => typeof item === 'string')
      : [];
    await tx
      .update(userSettings)
      .set({
        tool: {
          ...tool,
          humanIntervention: {
            ...humanIntervention,
            allowList: allowList.filter((item) => item !== resolution.rememberToolKey),
          },
        },
      })
      .where(eq(userSettings.id, this.userId));
    return 'rolled_back';
  };

  private retireResolvedRuntimeOperation = async (
    tx: Transaction,
    resolution: AgentInterventionResolutionItem,
    at: Date,
  ): Promise<void> => {
    if (resolution.action.type === 'stop' || resolution.action.type === 'cancel_interaction') {
      return;
    }
    const completedOperation = await tx
      .update(agentOperations)
      .set({ completedAt: at, completionReason: 'done', status: 'done' })
      .where(
        and(
          eq(agentOperations.id, resolution.operationId),
          eq(agentOperations.status, 'waiting_for_human'),
          eq(agentOperations.userId, this.userId),
          this.workspaceId
            ? eq(agentOperations.workspaceId, this.workspaceId)
            : isNull(agentOperations.workspaceId),
        ),
      )
      .returning({ id: agentOperations.id });
    if (completedOperation.length > 0) return;

    const [operation] = await tx
      .select({ status: agentOperations.status })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, resolution.operationId),
          eq(agentOperations.userId, this.userId),
          this.workspaceId
            ? eq(agentOperations.workspaceId, this.workspaceId)
            : isNull(agentOperations.workspaceId),
        ),
      )
      .limit(1);
    if (operation?.status !== 'done') {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }
  };

  private completeResolution = async (
    resolutionRequestId: string,
    source: AgentInterventionSource,
    at: Date,
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.transitionResolution(
      resolutionRequestId,
      async (tx, resolution, rows) => {
        if (resolution.source !== source) {
          throw new Error(AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH);
        }
        const terminalResolutionStatus = source === 'runtime' ? 'completed' : 'acknowledged';
        if (resolution.status === terminalResolutionStatus) {
          if (source === 'runtime') {
            await this.retireResolvedRuntimeOperation(tx, resolution, at);
          }
          return { interventions: rows, outcome: 'idempotent', resolution };
        }
        if (resolution.status !== 'published') {
          return { interventions: rows, outcome: 'conflict', resolution };
        }
        const [updatedResolution] = await tx
          .update(agentInterventionResolutions)
          .set({
            continuationStartedAt: source === 'runtime' ? at : undefined,
            producerAckAt: source === 'heterogeneous' ? at : undefined,
            status: terminalResolutionStatus,
            terminalAt: at,
            updatedAt: at,
            version: sql`${agentInterventionResolutions.version} + 1`,
          })
          .where(eq(agentInterventionResolutions.id, resolution.id))
          .returning();
        const updatedRows = await tx
          .update(agentInterventions)
          .set({
            producerAckAt: source === 'heterogeneous' ? at : undefined,
            resolvedAt: at,
            status: terminalStatusForAction(resolution.action),
            updatedAt: at,
            version: sql`${agentInterventions.version} + 1`,
          })
          .where(
            and(
              eq(agentInterventions.resolutionId, resolution.id),
              eq(agentInterventions.status, 'published'),
            ),
          )
          .returning();
        if (source === 'runtime') {
          await this.retireResolvedRuntimeOperation(tx, resolution, at);
        }
        return { interventions: updatedRows, outcome: 'applied', resolution: updatedResolution };
      },
      { lockOperation: source === 'runtime' },
    );

  private transitionResolution = async (
    resolutionRequestId: string,
    transition: (
      tx: Transaction,
      resolution: AgentInterventionResolutionItem,
      rows: AgentInterventionItem[],
    ) => Promise<AgentInterventionBatchMutationResult>,
    options?: { lockOperation?: boolean },
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({
          id: agentInterventionResolutions.id,
          operationId: agentInterventionResolutions.operationId,
        })
        .from(agentInterventionResolutions)
        .where(
          and(
            eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId),
            this.resolutionOwnership(),
          ),
        )
        .limit(1);
      if (!candidate) return { outcome: 'not_found' };

      if (options?.lockOperation) {
        const [operation] = await tx
          .select({ id: agentOperations.id })
          .from(agentOperations)
          .where(
            and(
              eq(agentOperations.id, candidate.operationId),
              eq(agentOperations.userId, this.userId),
              this.workspaceId
                ? eq(agentOperations.workspaceId, this.workspaceId)
                : isNull(agentOperations.workspaceId),
            ),
          )
          .limit(1)
          .for('update');
        if (!operation) return { outcome: 'not_found' };
      }

      // Batch terminal transitions lock intervention rows before their linked
      // resolutions. Preserve that order here to avoid timeout/ACK deadlocks.
      const rows = await tx
        .select()
        .from(agentInterventions)
        .where(eq(agentInterventions.resolutionId, candidate.id))
        .orderBy(asc(agentInterventions.itemIndex))
        .for('update');
      const [resolution] = await tx
        .select()
        .from(agentInterventionResolutions)
        .where(and(eq(agentInterventionResolutions.id, candidate.id), this.resolutionOwnership()))
        .limit(1)
        .for('update');
      if (!resolution) return { outcome: 'not_found' };
      return transition(tx, resolution, rows);
    });

  private resolveIdempotentClaim = async (
    resolution: AgentInterventionResolutionItem,
    params: ClaimAgentInterventionBatchParams,
  ): Promise<AgentInterventionBatchMutationResult> => {
    if (!this.isSameResolutionRequest(resolution, params)) {
      throw new Error(AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED);
    }
    if (resolution.status === 'rolled_back') {
      return this.reactivateRolledBackResolution(resolution.id, params);
    }
    const interventions = await this.db
      .select()
      .from(agentInterventions)
      .where(eq(agentInterventions.resolutionId, resolution.id))
      .orderBy(asc(agentInterventions.itemIndex));
    return { interventions, outcome: 'idempotent', resolution };
  };

  private isSameResolutionRequest = (
    resolution: AgentInterventionResolutionItem,
    params: ClaimAgentInterventionBatchParams,
  ): boolean =>
    resolution.operationId === params.operationId &&
    resolution.batchId === params.batchId &&
    resolution.actorId === params.actorId &&
    resolution.expectedItemCount === params.expectedItemCount &&
    resolution.scope === params.scope &&
    sameJson(resolution.selectedInterventionIds, uniqueSorted(params.selectedInterventionIds)) &&
    sameJson(resolution.expectedVersions, params.expectedVersions) &&
    sameJson(resolution.expectedRequestRevisionHashes, params.expectedRequestRevisionHashes) &&
    sameJson(resolution.action, params.action);

  /**
   * A transport failure rolls a claim back to pending but clients intentionally
   * retain the same resolutionRequestId: changing it after an ambiguous
   * response could execute the action twice. Reactivate that exact request only
   * while its complete original snapshot is still pending and unchanged. A new
   * winner, an argument edit, timeout, or any identity drift fails closed.
   */
  private reactivateRolledBackResolution = async (
    resolutionId: string,
    params: ClaimAgentInterventionBatchParams,
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(agentInterventions)
        .where(
          and(
            eq(agentInterventions.operationId, params.operationId),
            eq(agentInterventions.batchId, params.batchId),
            this.ownership(),
          ),
        )
        .orderBy(asc(agentInterventions.itemIndex))
        .for('update');
      if (rows.length === 0) return { outcome: 'not_found' };

      const [resolution] = await tx
        .select()
        .from(agentInterventionResolutions)
        .where(and(eq(agentInterventionResolutions.id, resolutionId), this.resolutionOwnership()))
        .limit(1)
        .for('update');
      if (!resolution) return { outcome: 'not_found' };
      if (!this.isSameResolutionRequest(resolution, params)) {
        throw new Error(AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED);
      }

      // A concurrent retry may already have reactivated or completed this exact
      // request. Return its current linked rows instead of applying effects twice.
      if (resolution.status !== 'rolled_back') {
        return {
          interventions: rows.filter((row) => row.resolutionId === resolution.id),
          outcome: 'idempotent',
          resolution,
        };
      }

      const now = new Date();
      if (
        rows.some(
          (row) =>
            ['pending', 'resolving', 'published'].includes(row.status) &&
            row.deadline.getTime() <= now.getTime(),
        )
      ) {
        const terminalRows = await this.markRowsTerminalInTransaction(tx, rows, 'timed_out', now);
        return { interventions: terminalRows, outcome: 'conflict', resolution };
      }

      const ids = rows.map((row) => row.id);
      const unchangedSnapshot =
        rows.length === params.expectedItemCount &&
        rows.every(
          (row, index) =>
            row.sealed &&
            row.itemCount === rows.length &&
            row.itemIndex === index &&
            params.expectedRequestRevisionHashes[row.id] === row.requestRevisionHash,
        ) &&
        hasExactKeys(params.expectedVersions, ids) &&
        hasExactKeys(params.expectedRequestRevisionHashes, ids);
      if (!unchangedSnapshot) return { interventions: rows, outcome: 'conflict', resolution };

      const selectedIds = uniqueSorted(params.selectedInterventionIds);
      const targets = rows.filter((row) => selectedIds.includes(row.id));
      if (
        !this.hasValidSelection(rows, targets, params, selectedIds) ||
        targets.some((row) => row.status !== 'pending' || row.resolutionId !== null)
      ) {
        return { interventions: rows, outcome: 'conflict', resolution };
      }
      this.validateAction(targets, params);

      const argumentEffect = await this.applyArgumentEffect(tx, targets, params.action);
      let rememberToolKey: null | string = null;
      let rememberEffectStatus: 'applied' | 'retained' | null = null;
      if (params.action.type === 'approve_remember') {
        const remember = await this.applyRememberEffect(tx, params.actorId, targets[0]);
        rememberToolKey = remember.toolKey;
        rememberEffectStatus = remember.status;
      }

      const [reactivatedResolution] = await tx
        .update(agentInterventionResolutions)
        .set({
          argumentEffectStatus: argumentEffect ? 'applied' : null,
          continuationStartedAt: null,
          editedArguments: argumentEffect?.editedArguments ?? null,
          editedRequestRevisionHash: argumentEffect?.editedRequestRevisionHash ?? null,
          originalArguments: argumentEffect?.originalArguments ?? null,
          originalRequestRevisionHash: argumentEffect?.originalRequestRevisionHash ?? null,
          producerAckAt: null,
          publishedAt: null,
          rememberEffectStatus,
          rememberToolKey,
          resolvingAt: now,
          rolledBackAt: null,
          status: 'resolving',
          terminalAt: null,
          updatedAt: now,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventionResolutions.id, resolution.id),
            eq(agentInterventionResolutions.status, 'rolled_back'),
          ),
        )
        .returning();
      if (!reactivatedResolution) {
        throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
      }

      const claimed = await tx
        .update(agentInterventions)
        .set({
          requestRevisionHash: argumentEffect?.editedRequestRevisionHash,
          resolutionId: resolution.id,
          resolvingAt: now,
          status: 'resolving',
          updatedAt: now,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(
          and(
            inArray(agentInterventions.id, selectedIds),
            this.ownership(),
            eq(agentInterventions.status, 'pending'),
            isNull(agentInterventions.resolutionId),
            gt(agentInterventions.deadline, now),
          ),
        )
        .returning();
      if (claimed.length !== selectedIds.length) {
        throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
      }

      const updatedRows = rows.map((row) => claimed.find((item) => item.id === row.id) ?? row);
      return {
        interventions: updatedRows,
        outcome: 'applied',
        resolution: reactivatedResolution,
      };
    });

  private reload = async (id: string): Promise<AgentInterventionItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(agentInterventions)
      .where(and(eq(agentInterventions.id, id), this.ownership()))
      .limit(1);
    return row;
  };

  private reloadBatch = (operationId: string, batchId: string): Promise<AgentInterventionItem[]> =>
    this.db
      .select()
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.operationId, operationId),
          eq(agentInterventions.batchId, batchId),
          this.ownership(),
        ),
      )
      .orderBy(asc(agentInterventions.itemIndex));

  private withLazyTimeout = async (
    row: AgentInterventionItem,
    now = new Date(),
  ): Promise<AgentInterventionItem> => {
    if (
      !['pending', 'resolving', 'published'].includes(row.status) ||
      row.deadline.getTime() > now.getTime()
    ) {
      return row;
    }
    await this.markBatchTerminal(row.operationId, row.batchId, 'timed_out', now);
    return (await this.reload(row.id)) ?? row;
  };

  /** Owner-only cold lookup can recover the row's workspace before expiring its batch. */
  private withOwnerLazyTimeout = async (
    row: AgentInterventionItem,
    now = new Date(),
  ): Promise<AgentInterventionItem> => {
    if (
      !['pending', 'resolving', 'published'].includes(row.status) ||
      row.deadline.getTime() > now.getTime()
    ) {
      return row;
    }
    const scopedModel = new AgentInterventionModel(
      this.db,
      this.userId,
      row.workspaceId ?? undefined,
    );
    await scopedModel.markBatchTerminal(row.operationId, row.batchId, 'timed_out', now);
    const [updated] = await this.db
      .select()
      .from(agentInterventions)
      .where(and(eq(agentInterventions.id, row.id), this.ownerOnly()))
      .limit(1);
    return updated ?? row;
  };
}
