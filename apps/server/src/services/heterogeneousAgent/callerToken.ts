import type { LobeChatDatabase } from '@/database/type';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';

import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from './operationPrincipal';

export class HeteroCallerTokenError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'HeteroCallerTokenError';
  }
}

const describeScope = (workspaceId?: string) =>
  workspaceId ? `workspace ${workspaceId}` : 'the personal space';

/**
 * Authorize a device run's operation token on an ordinary user endpoint.
 *
 * The agent's own `lh` commands use this token, so they act as the user who
 * started the run, not as whoever is logged in on the device. Every request
 * re-checks durable state, so the token stops working when the run ends, when
 * the user loses access, or outside the run's workspace:
 *
 * - the requested scope must be the run's scope: its workspace, or the personal
 *   space for a personal run;
 * - the operation must still be running, belong to the token's user and
 *   workspace, and the user must still be an active member.
 *
 * Errors carry 401 when the token is no longer valid (run ended, user inactive)
 * and 403 when it is valid but not for this scope.
 */
export const authorizeHeteroCallerToken = async (params: {
  claims: HeteroOperationJwtClaims;
  db: LobeChatDatabase;
  requestedWorkspaceId?: string | null;
}) => {
  const { claims, db } = params;
  const tokenWorkspaceId = claims.workspace_id || undefined;
  const requestedWorkspaceId = params.requestedWorkspaceId?.trim() || undefined;

  if (requestedWorkspaceId !== tokenWorkspaceId) {
    throw new HeteroCallerTokenError(
      `This run's token only works in ${describeScope(tokenWorkspaceId)}, not in ${describeScope(requestedWorkspaceId)}.`,
      403,
    );
  }

  try {
    return await resolveActiveHeteroOperationPrincipal({
      capability: 'caller:act',
      claims,
      db,
      operationId: claims.operation_id,
    });
  } catch (error) {
    if (!(error instanceof HeteroOperationPrincipalError)) throw error;
    if (error.status === 409)
      throw new HeteroCallerTokenError('This run has ended, so its token no longer works.', 401);
    throw new HeteroCallerTokenError(error.message, error.status === 401 ? 401 : 403);
  }
};
