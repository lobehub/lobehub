import { AGENT_SIGNAL_KEYS } from '../../../constants';
import type { AgentSignalReceipt } from '../../../services/receiptService';
import type { AgentSignalReceiptStore } from '../../types';
import { getRedisClient, readHash, trySetNx, writeHash } from './shared';

const toReceiptHash = (receipt: AgentSignalReceipt): Record<string, string> => ({
  agentId: receipt.agentId,
  ...(receipt.anchorMessageId ? { anchorMessageId: receipt.anchorMessageId } : {}),
  createdAt: String(receipt.createdAt),
  detail: receipt.detail,
  id: receipt.id,
  kind: receipt.kind,
  ...(receipt.metadata ? { metadata: JSON.stringify(receipt.metadata) } : {}),
  ...(receipt.operationId ? { operationId: receipt.operationId } : {}),
  sourceId: receipt.sourceId,
  sourceType: receipt.sourceType,
  status: receipt.status,
  ...(receipt.target ? { target: JSON.stringify(receipt.target) } : {}),
  title: receipt.title,
  topicId: receipt.topicId,
  userId: receipt.userId,
});

const parseReceiptTarget = (value?: string): AgentSignalReceipt['target'] | undefined => {
  if (!value) return;

  try {
    const target = JSON.parse(value) as Record<string, unknown>;

    if (target.type !== 'memory' && target.type !== 'skill') return;
    if (typeof target.title !== 'string' || target.title.length === 0) return;

    return {
      ...(typeof target.agentDocumentId === 'string' && target.agentDocumentId.length > 0
        ? { agentDocumentId: target.agentDocumentId }
        : {}),
      ...(typeof target.documentId === 'string' && target.documentId.length > 0
        ? { documentId: target.documentId }
        : {}),
      ...(typeof target.id === 'string' && target.id.length > 0 ? { id: target.id } : {}),
      ...(typeof target.summary === 'string' && target.summary.length > 0
        ? { summary: target.summary }
        : {}),
      title: target.title,
      type: target.type,
    };
  } catch {
    return;
  }
};

const parseReceiptMetadata = (value?: string): AgentSignalReceipt['metadata'] | undefined => {
  if (!value) return;

  try {
    const metadata = JSON.parse(value);

    return metadata && typeof metadata === 'object'
      ? (metadata as AgentSignalReceipt['metadata'])
      : undefined;
  } catch {
    return;
  }
};

const fromReceiptHash = (payload: Record<string, string>): AgentSignalReceipt | undefined => {
  const createdAt = Number(payload.createdAt);

  if (!payload.id || !payload.userId || !payload.agentId || !payload.topicId) return;
  if (payload.kind !== 'memory' && payload.kind !== 'review' && payload.kind !== 'skill') {
    return;
  }
  if (
    payload.status !== 'applied' &&
    payload.status !== 'completed' &&
    payload.status !== 'failed' &&
    payload.status !== 'proposed' &&
    payload.status !== 'skipped' &&
    payload.status !== 'updated'
  ) {
    return;
  }
  if (!Number.isFinite(createdAt)) return;

  const target = parseReceiptTarget(payload.target);
  const metadata = parseReceiptMetadata(payload.metadata);

  return {
    agentId: payload.agentId,
    anchorMessageId: payload.anchorMessageId,
    createdAt,
    detail: payload.detail,
    id: payload.id,
    kind: payload.kind,
    ...(metadata ? { metadata } : {}),
    operationId: payload.operationId,
    sourceId: payload.sourceId,
    sourceType: payload.sourceType,
    status: payload.status,
    ...(target ? { target } : {}),
    title: payload.title,
    topicId: payload.topicId,
    userId: payload.userId,
  };
};

/** Appends one deduped receipt payload and its scoped topic index entry. */
export const appendReceipt: AgentSignalReceiptStore['appendReceipt'] = async (
  receipt,
  ttlSeconds,
) => {
  const redis = getRedisClient();
  if (!redis) return false;

  const accepted = await trySetNx(AGENT_SIGNAL_KEYS.receiptDedupe(receipt.id), ttlSeconds);
  if (!accepted) return false;

  const receiptKey = AGENT_SIGNAL_KEYS.receipt(receipt.id);
  const indexKey = AGENT_SIGNAL_KEYS.receiptIndex(receipt);

  await writeHash(receiptKey, toReceiptHash(receipt), ttlSeconds);
  await redis.zadd(indexKey, receipt.createdAt, receipt.id);
  await redis.expire(indexKey, ttlSeconds);

  return true;
};

/**
 * Lists newest receipts from one scoped topic index and prunes expired payload references.
 */
export const listReceipts: AgentSignalReceiptStore['listReceipts'] = async (input) => {
  const redis = getRedisClient();
  if (!redis) return { cursor: undefined, receipts: [] };

  const indexKey = AGENT_SIGNAL_KEYS.receiptIndex(input);
  const start = input.cursor ?? 0;
  const stop = start + input.limit;
  const ids =
    input.sinceCreatedAt === undefined
      ? await redis.zrevrange(indexKey, start, stop)
      : await redis.zrange(
          indexKey,
          '+inf',
          `(${input.sinceCreatedAt}`,
          'BYSCORE',
          'REV',
          'LIMIT',
          0,
          input.limit + 1,
        );
  const receipts: AgentSignalReceipt[] = [];
  const missingIds: string[] = [];

  for (const id of ids.slice(0, input.limit)) {
    const payload = await readHash(AGENT_SIGNAL_KEYS.receipt(id));
    const receipt = payload ? fromReceiptHash(payload) : undefined;

    if (!receipt) {
      missingIds.push(id);
      continue;
    }

    if (
      receipt.userId === input.userId &&
      receipt.agentId === input.agentId &&
      receipt.topicId === input.topicId
    ) {
      receipts.push(receipt);
    }
  }

  if (missingIds.length > 0) {
    await redis.zrem(indexKey, ...missingIds);
  }

  return {
    cursor:
      input.sinceCreatedAt === undefined && ids.length > input.limit
        ? start + input.limit
        : undefined,
    receipts,
  };
};

/** Redis-backed Agent Signal receipt store. */
export const redisReceiptStore: AgentSignalReceiptStore = {
  appendReceipt,
  listReceipts,
};
