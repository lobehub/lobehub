import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';

const log = debug('lobe-server:ai-agent-service');

/**
 * Where a device-hosted heterogeneous run's process lives, so a Stop can reach
 * it. The topic's `runningOperation` marker carries the same route, but a
 * sub-agent child only appears there while its parent's turn is running: a
 * background child outlives it, and stopping it must still find the device.
 * The operation row is that durable copy.
 */
export interface HeteroDeviceRoute {
  deviceId: string;
  deviceUserId?: string;
  deviceWorkspaceId?: string;
  heteroType: string;
  /** Same shape as a marker entry; the route's own run. */
  operationId?: string;
}

const ROUTE_KEY = 'heteroDeviceRoute';

/** Record the route on the operation row. Never throws. */
export const recordHeteroDeviceRoute = async (
  scope: { db: LobeChatDatabase; userId: string; workspaceId?: string },
  operationId: string,
  route: HeteroDeviceRoute,
): Promise<void> => {
  try {
    await new AgentOperationModel(scope.db, scope.userId, scope.workspaceId).mergeMetadata(
      operationId,
      { [ROUTE_KEY]: route },
    );
  } catch (error) {
    log('recordHeteroDeviceRoute: op=%s failed: %O', operationId, error);
  }
};

/** The route recorded on an operation row's metadata, when there is one. */
export const readHeteroDeviceRoute = (metadata: unknown): HeteroDeviceRoute | undefined => {
  const route = (metadata as Record<string, unknown> | null | undefined)?.[ROUTE_KEY] as
    Partial<HeteroDeviceRoute> | undefined;
  if (typeof route?.deviceId !== 'string' || typeof route.heteroType !== 'string') return;
  return route as HeteroDeviceRoute;
};
