import type {
  CollaborativeTargetLease,
  CollaborativeTargetLeaseCapabilities,
  YjsAwarenessUser,
} from '@lobehub/editor';

import type { PageRewriteRequest, PageRewriteStatus } from '../Copilot/rewriteRequests';

const LEASE_STATUSES = new Set<PageRewriteStatus>([
  'queued',
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'awaiting_review',
  'cancel_requested',
  'retry_wait',
]);

const LEASE_FALLBACK_TTL_MS = 30_000;

const BLOCKED_CAPABILITIES: CollaborativeTargetLeaseCapabilities = {
  delete: true,
  edit: true,
  move: true,
  select: true,
};

interface AwarenessState {
  awarenessData?: {
    documentId?: unknown;
    generationId?: unknown;
    requestId?: unknown;
    selectionRange?: { targetNodeIds?: unknown };
    sessionId?: unknown;
    status?: unknown;
    targetNodeIds?: unknown;
  };
  name?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nodeIdsFromSelection = (selection: unknown): string[] => {
  if (!isRecord(selection) || selection.targetKind !== 'node') return [];
  const targetNodeId = typeof selection.targetNodeId === 'string' ? selection.targetNodeId : null;
  const targetNodeIds = Array.isArray(selection.targetNodeIds)
    ? selection.targetNodeIds.filter(
        (nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0,
      )
    : [];
  return [...new Set([...(targetNodeId ? [targetNodeId] : []), ...targetNodeIds])];
};

const awarenessNodeIds = (state: AwarenessState): string[] => {
  const data = state.awarenessData;
  if (!data) return [];
  const direct = Array.isArray(data.targetNodeIds)
    ? data.targetNodeIds.filter(
        (nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0,
      )
    : [];
  const range = Array.isArray(data.selectionRange?.targetNodeIds)
    ? data.selectionRange.targetNodeIds.filter(
        (nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0,
      )
    : [];
  return [...new Set([...direct, ...range])];
};

const expiresAtFrom = (value: unknown, now: number): number => {
  const parsed =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : typeof value === 'number'
          ? value
          : Number.NaN;
  return Number.isFinite(parsed) && parsed > now ? Math.trunc(parsed) : now + LEASE_FALLBACK_TTL_MS;
};

const hasExpired = (value: unknown, now: number): boolean => {
  const parsed =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : typeof value === 'number'
          ? value
          : Number.NaN;
  return Number.isFinite(parsed) && parsed <= now;
};

const requestLeases = (
  documentId: string,
  requests: readonly PageRewriteRequest[],
  now: number,
): CollaborativeTargetLease[] => {
  const leases: CollaborativeTargetLease[] = [];
  for (const request of requests) {
    if (request.documentId !== documentId) continue;
    if (!LEASE_STATUSES.has(request.status)) continue;
    if (hasExpired(request.expiresAt, now)) continue;
    for (const nodeId of nodeIdsFromSelection(request.selection)) {
      leases.push({
        capabilities: BLOCKED_CAPABILITIES,
        expiresAt: expiresAtFrom(request.expiresAt, now),
        generation: `${request.updatedAt}:${request.status}`,
        id: `rewrite-request:${request.id}:${nodeId}`,
        ownerId: `rewrite-request:${request.id}`,
        requestId: request.id,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        target: { documentId, nodeId, targetKind: 'node' },
      });
    }
  }
  return leases;
};

const awarenessLeases = (
  documentId: string,
  users: readonly YjsAwarenessUser[],
  now: number,
): CollaborativeTargetLease[] => {
  const leases: CollaborativeTargetLease[] = [];
  for (const user of users) {
    const state = user.state as AwarenessState;
    const data = state.awarenessData;
    if (
      !data ||
      data.documentId !== documentId ||
      typeof data.status !== 'string' ||
      !LEASE_STATUSES.has(data.status as PageRewriteStatus)
    ) {
      continue;
    }
    const requestId =
      typeof data.requestId === 'string' ? data.requestId : `awareness:${user.clientId}`;
    for (const nodeId of awarenessNodeIds(state)) {
      leases.push({
        capabilities: BLOCKED_CAPABILITIES,
        expiresAt: now + LEASE_FALLBACK_TTL_MS,
        ...(typeof data.generationId === 'string' ? { generation: data.generationId } : {}),
        id: `rewrite-request:${requestId}:${nodeId}`,
        ownerId: requestId,
        ...(typeof state.name === 'string' ? { ownerLabel: state.name } : {}),
        requestId,
        ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
        target: { documentId, nodeId, targetKind: 'node' },
      });
    }
  }
  return leases;
};

export const createPageRewriteTargetLeases = ({
  awarenessUsers = [],
  documentId,
  now = Date.now(),
  requests = [],
}: {
  awarenessUsers?: readonly YjsAwarenessUser[];
  documentId?: string;
  now?: number;
  requests?: readonly PageRewriteRequest[];
}): CollaborativeTargetLease[] => {
  if (!documentId) return [];
  const byId = new Map<string, CollaborativeTargetLease>();
  for (const lease of requestLeases(documentId, requests, now)) byId.set(lease.id, lease);
  for (const lease of awarenessLeases(documentId, awarenessUsers, now)) byId.set(lease.id, lease);
  return [...byId.values()];
};
