import type { LobeChatDatabase } from '@lobechat/database';
import { eq } from 'drizzle-orm';

import { agentOperations } from '@/database/schemas/agentOperations';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';

export interface OperationOwner {
  /** Set only for a shared-agent visitor run: the visitor owns the stream. */
  streamOwnerUserId?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Whose rows a background delivery should read and write.
 *
 * Same trust chain as `/subagent-callback`: the caller is service-token
 * verified and the operation row is the authority. The Redis metadata is the
 * fast path; it can be gone after a reap, and a 401 there would drop a result
 * the device cannot resend — so fall back to the durable row.
 */
export async function resolveOperationOwner(
  serverDB: LobeChatDatabase,
  operationId: string,
): Promise<OperationOwner | undefined> {
  const metadata = await new AgentRuntimeCoordinator().getOperationMetadata(operationId);

  if (metadata?.userId) {
    return {
      streamOwnerUserId: metadata.streamOwnerUserId,
      userId: metadata.userId,
      workspaceId: metadata.workspaceId,
    };
  }

  const [row] = await serverDB
    .select({ userId: agentOperations.userId, workspaceId: agentOperations.workspaceId })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);

  return row ? { userId: row.userId, workspaceId: row.workspaceId ?? undefined } : undefined;
}
