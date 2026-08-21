import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';
import { validateHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';
import { extractBearerToken } from '@/utils/server/auth';

export const requireHeteroModelInvocation = async (c: Context, next: Next) => {
  if (process.env.ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT === '0') {
    throw new HTTPException(403, { message: 'Server-default agents are disabled' });
  }

  const token = extractBearerToken(c.req.header('Authorization'));
  const claims = token ? await validateHeteroOperationJWT(token) : null;
  if (!claims) throw new HTTPException(401, { message: 'Invalid operation token' });

  try {
    const principal = await resolveActiveHeteroOperationPrincipal({
      capability: 'model:invoke',
      claims,
      db: await getServerDB(),
      operationId: claims.operation_id,
    });
    c.set('heteroOperationClaims', claims satisfies HeteroOperationJwtClaims);
    c.set('userId', principal.userId);
    c.set('workspaceId', principal.workspaceId);
  } catch (error) {
    if (error instanceof HeteroOperationPrincipalError) {
      throw new HTTPException(error.status, { message: error.message });
    }
    throw error;
  }
  return next();
};
