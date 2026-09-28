import type { ServerDefaultHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { isServerDefaultHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { eq } from 'drizzle-orm';

import { RbacModel } from '@/database/models/rbac';
import { hasActiveWorkspaceMembership } from '@/database/models/workspace';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertOIDCUserActive } from '@/libs/oidc-provider/access-control';
import type {
  HeteroOperationCapability,
  HeteroOperationJwtClaims,
} from '@/libs/trpc/utils/internalJwt';
import { getScopePermissions } from '@/utils/rbac';

export class HeteroOperationPrincipalError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 409,
  ) {
    super(message);
    this.name = 'HeteroOperationPrincipalError';
  }
}

export interface ActiveHeteroOperationPrincipal {
  agentType?: ServerDefaultHeterogeneousAgentType;
  operationId: string;
  userId: string;
  workspaceId?: string;
}

/** Resolve and re-authorize an operation token against current durable state. */
export const resolveActiveHeteroOperationPrincipal = async (params: {
  /**
   * Let the callback through when the operation row is already terminal.
   *
   * Only for the callbacks whose whole job is to report on a run that ended —
   * `heteroIngest` answers "this batch was discarded", `heteroFinish` lands the
   * turn's outcome. Rejecting those at the door leaves the producer retrying a
   * permanent refusal and the user on an assistant bubble that never resolves.
   * Every other check still runs, and neither callback can write anything to a
   * terminal operation: the service refuses them on the same status, which is
   * exactly the answer they exist to deliver. Live-work capabilities
   * (`model:invoke`, token renewal, goal mutations) must never set this.
   */
  allowTerminalOperation?: boolean;
  capability: HeteroOperationCapability;
  claims: HeteroOperationJwtClaims;
  db: LobeChatDatabase;
  operationId: string;
}): Promise<ActiveHeteroOperationPrincipal> => {
  const { allowTerminalOperation, capability, claims, db, operationId } = params;
  if (claims.operation_id !== operationId || !claims.capabilities.includes(capability)) {
    throw new HeteroOperationPrincipalError('Operation token does not grant this request', 403);
  }

  await assertOIDCUserActive(db, claims.sub).catch(() => {
    throw new HeteroOperationPrincipalError('Operation user is no longer active', 401);
  });

  const [operation] = await db
    .select({
      id: agentOperations.id,
      metadata: agentOperations.metadata,
      model: agentOperations.model,
      provider: agentOperations.provider,
      status: agentOperations.status,
      userId: agentOperations.userId,
      workspaceId: agentOperations.workspaceId,
    })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);

  if (
    !operation ||
    operation.userId !== claims.sub ||
    operation.workspaceId !== (claims.workspace_id ?? null) ||
    (claims.model !== undefined && operation.model !== claims.model) ||
    (claims.provider_id !== undefined && operation.provider !== claims.provider_id)
  ) {
    throw new HeteroOperationPrincipalError('Operation is outside the token scope', 403);
  }
  if (operation.status !== 'running' && !allowTerminalOperation) {
    throw new HeteroOperationPrincipalError('Operation has already ended', 409);
  }

  const metadataAgentType = operation.metadata?.agentType;
  const agentType =
    operation.metadata?.serverDefaultHeterogeneous === true &&
    typeof metadataAgentType === 'string' &&
    isServerDefaultHeterogeneousAgentType(metadataAgentType)
      ? metadataAgentType
      : undefined;
  if (capability === 'model:invoke' && (!claims.model || !claims.provider_id || !agentType)) {
    throw new HeteroOperationPrincipalError(
      'Operation token has no valid server model selection',
      403,
    );
  }

  const workspaceId = operation.workspaceId ?? undefined;
  if (
    workspaceId &&
    !(await hasActiveWorkspaceMembership(db, { userId: claims.sub, workspaceId }))
  ) {
    throw new HeteroOperationPrincipalError('Workspace membership is no longer active', 403);
  }

  const permitted = await new RbacModel(db, claims.sub).hasAnyPermission(
    getScopePermissions('AI_MODEL_INVOKE', ['ALL', 'OWNER']),
    { userId: claims.sub, workspaceId },
  );
  if (!permitted) {
    throw new HeteroOperationPrincipalError('Model invocation is no longer permitted', 403);
  }

  return { agentType, operationId, userId: claims.sub, workspaceId };
};
