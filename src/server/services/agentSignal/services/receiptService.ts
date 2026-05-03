import type { AgentSignalSource, BaseAction, ExecutorResult } from '@lobechat/agent-signal';

import { AGENT_SIGNAL_DEFAULTS } from '../constants';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../policies/types';
import { redisReceiptStore } from '../store/adapters/redis/receiptStore';

/**
 * User-visible Agent Signal receipt persisted for recent topic activity.
 */
export interface AgentSignalReceipt {
  /** Agent that owns the topic. */
  agentId: string;
  /** Assistant message this receipt should render under when known. */
  anchorMessageId?: string;
  /** Millisecond timestamp used for newest-first receipt indexes. */
  createdAt: number;
  /** Fallback detail copy for clients without locale keys. */
  detail: string;
  /** Stable receipt id used as Redis member and payload key suffix. */
  id: string;
  /** User-facing durable outcome domain. */
  kind: 'memory' | 'skill';
  /** Agent runtime operation that produced the receipt, when known. */
  operationId?: string;
  /** Source event id that triggered the receipt. */
  sourceId: string;
  /** Source event type that triggered the receipt. */
  sourceType: string;
  /** User-facing terminal status. */
  status: 'applied' | 'updated';
  /** Snapshot of the resource affected when the receipt was produced. */
  target?: {
    /** Backing resource id for future navigation when still available. Skill ids use `documents.id`. */
    id?: string;
    /** Short summary captured at write time. */
    summary?: string;
    /** Human-readable resource title captured at write time. */
    title: string;
    /** User-facing resource domain. */
    type: 'memory' | 'skill';
  };
  /** Fallback title copy for clients without locale keys. */
  title: string;
  /** Topic where the receipt should be listed. */
  topicId: string;
  /** Owner used to enforce topic index isolation. */
  userId: string;
}

/** Query input for one scoped receipt page. */
export interface AgentSignalReceiptListInput {
  /** Agent whose topic receipts should be listed. */
  agentId: string;
  /** Zero-based sorted-set offset for the next page. */
  cursor?: number;
  /** Maximum receipt count to return. */
  limit: number;
  /** Topic whose receipts should be listed. */
  topicId: string;
  /** Current authenticated user. */
  userId: string;
}

/** Newest-first receipt page. */
export interface AgentSignalReceiptListResult {
  /** Next zero-based sorted-set offset, when another page exists. */
  cursor?: number;
  /** Receipts newest first. */
  receipts: AgentSignalReceipt[];
}

/** Storage contract for user-visible Agent Signal receipt history. */
export interface AgentSignalReceiptStore {
  appendReceipt: (receipt: AgentSignalReceipt, ttlSeconds: number) => Promise<boolean>;
  listReceipts: (input: AgentSignalReceiptListInput) => Promise<AgentSignalReceiptListResult>;
}

interface ProjectAgentSignalReceiptsInput {
  actions: BaseAction[];
  results: ExecutorResult[];
  source: AgentSignalSource;
  userId: string;
}

interface PersistAgentSignalReceiptsOptions {
  store?: AgentSignalReceiptStore;
}

const getPayloadString = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const getClampedString = (value: string, maxLength = 96) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const getReceiptTarget = (
  action: BaseAction,
  result: ExecutorResult,
  kind: AgentSignalReceipt['kind'],
): AgentSignalReceipt['target'] | undefined => {
  const target = result.output?.target;

  if (target && typeof target === 'object') {
    const payload = target as Record<string, unknown>;
    const title = typeof payload.title === 'string' ? payload.title.trim() : undefined;
    const type = payload.type === 'memory' || payload.type === 'skill' ? payload.type : kind;

    if (title) {
      return {
        ...(typeof payload.id === 'string' && payload.id.length > 0 ? { id: payload.id } : {}),
        ...(typeof payload.summary === 'string' && payload.summary.length > 0
          ? { summary: payload.summary }
          : {}),
        title,
        type,
      };
    }
  }

  if (kind !== 'memory') return;

  const message = getPayloadString(action.payload, 'message')?.trim();
  if (!message) return;

  return {
    title: getClampedString(message),
    type: 'memory',
  };
};

const toReceiptKind = (
  action: BaseAction,
): Pick<AgentSignalReceipt, 'detail' | 'kind' | 'status' | 'title'> | undefined => {
  if (action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle) {
    return {
      detail: 'Saved this for future replies',
      kind: 'memory',
      status: 'applied',
      title: 'Memory saved',
    };
  }

  if (action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle) {
    return {
      detail: 'Improved how this assistant handles similar requests',
      kind: 'skill',
      status: 'updated',
      title: 'Skill updated',
    };
  }

  return;
};

/**
 * Projects terminal Agent Signal runtime results into user-visible receipts.
 *
 * Use when:
 * - Runtime orchestration has completed and action executor results are available
 * - Only durable, applied memory/skill outcomes should be shown to users
 *
 * Expects:
 * - `results` reference `actions` by `actionId`
 * - `source.payload.agentId` and `source.payload.topicId` identify the chat context
 *
 * Returns:
 * - Zero or more receipt payloads safe to persist in the recent receipt store
 */
export const projectAgentSignalReceipts = ({
  actions,
  results,
  source,
  userId,
}: ProjectAgentSignalReceiptsInput): AgentSignalReceipt[] => {
  const payload = source.payload as Record<string, unknown>;
  const agentId = getPayloadString(payload, 'agentId');
  const topicId = getPayloadString(payload, 'topicId');

  if (!agentId || !topicId) return [];

  const actionById = new Map(actions.map((action) => [action.actionId, action]));

  return results.flatMap((result) => {
    if (result.status !== 'applied') return [];

    const action = actionById.get(result.actionId);
    if (!action) return [];

    const visibleOutcome = toReceiptKind(action);
    if (!visibleOutcome) return [];

    const target = getReceiptTarget(action, result, visibleOutcome.kind);

    return [
      {
        ...visibleOutcome,
        agentId,
        anchorMessageId: getPayloadString(payload, 'assistantMessageId'),
        createdAt: source.timestamp,
        id: `${source.sourceId}:${result.actionId}:${visibleOutcome.kind}`,
        operationId: getPayloadString(payload, 'operationId'),
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        topicId,
        ...(target ? { target } : {}),
        userId,
      },
    ];
  });
};

/**
 * Persists user-visible Agent Signal receipts into recent Redis history.
 *
 * Use when:
 * - Agent Signal orchestration has projected terminal receipt outcomes
 * - The caller wants deduped, TTL-bound product feedback
 *
 * Expects:
 * - Receipts already passed product filtering
 *
 * Returns:
 * - Nothing; individual duplicate receipts are ignored by the store
 */
export const persistAgentSignalReceipts = async (
  receipts: AgentSignalReceipt[],
  options: PersistAgentSignalReceiptsOptions = {},
): Promise<void> => {
  const store = options.store ?? redisReceiptStore;

  const results = await Promise.allSettled(
    receipts.map((receipt) =>
      store.appendReceipt(receipt, AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds),
    ),
  );

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') continue;

    const receipt = receipts[index];
    console.error('[AgentSignal] Failed to persist receipt:', {
      error: result.reason,
      id: receipt?.id,
      kind: receipt?.kind,
      sourceId: receipt?.sourceId,
      topicId: receipt?.topicId,
    });
  }
};

/**
 * Lists recent Agent Signal receipts for one user-owned topic.
 */
export const listAgentSignalReceipts = async (
  input: AgentSignalReceiptListInput,
  options: { store?: AgentSignalReceiptStore } = {},
) => {
  return (options.store ?? redisReceiptStore).listReceipts(input);
};
