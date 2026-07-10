import type { GatewayQueueContext } from '@lobechat/types';

export const GATEWAY_MESSAGE_QUEUE_PREFIX = 'gateway-message-queue:v1';

export interface GatewayQueueTenantScope {
  userId: string;
  workspaceId?: string;
}

export interface GatewayQueueRedisKeys {
  active: string;
  context: string;
  dedup: string;
  handoffPointer: string;
  inflight: string;
  queue: string;
}

const encodeKeyPart = (value: string | undefined): string =>
  value === undefined ? 'u' : `v${encodeURIComponent(value)}`;

export const buildGatewayQueueTenantPrefix = ({
  userId,
  workspaceId,
}: GatewayQueueTenantScope): string =>
  `${GATEWAY_MESSAGE_QUEUE_PREFIX}:tenant:${encodeKeyPart(userId)}:${encodeKeyPart(workspaceId)}`;

export const buildGatewayQueueContextKey = (
  tenant: GatewayQueueTenantScope,
  context: GatewayQueueContext,
): string => {
  const tenantPrefix = buildGatewayQueueTenantPrefix(tenant);

  return [
    tenantPrefix,
    'context',
    encodeKeyPart(context.agentId),
    encodeKeyPart(context.topicId),
    encodeKeyPart(context.groupId),
    encodeKeyPart(context.threadId),
  ].join(':');
};

export const buildGatewayQueueRedisKeys = (contextKey: string): GatewayQueueRedisKeys => ({
  active: `${contextKey}:active`,
  context: `${contextKey}:metadata`,
  dedup: `${contextKey}:dedup`,
  handoffPointer: `${contextKey}:handoff`,
  inflight: `${contextKey}:inflight`,
  queue: `${contextKey}:queue`,
});

export const buildGatewayQueueOperationKey = (
  tenant: GatewayQueueTenantScope,
  operationId: string,
): string => `${buildGatewayQueueTenantPrefix(tenant)}:operation:${encodeKeyPart(operationId)}`;

export const buildGatewayQueueHandoffReceiptKey = (
  tenant: GatewayQueueTenantScope,
  oldOperationId: string,
): string =>
  `${buildGatewayQueueTenantPrefix(tenant)}:handoff-receipt:${encodeKeyPart(oldOperationId)}`;
