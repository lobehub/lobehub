import type { ServerDefaultHeterogeneousIngress } from '@lobechat/heterogeneous-agents';
import { getServerDefaultHeterogeneousAgentConfig } from '@lobechat/heterogeneous-agents';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentOperationModel } from '@/database/models/agentOperation';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';
import { validateHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';
import { extractBearerToken } from '@/utils/server/auth';

export const requireHeteroModelInvocation =
  (ingress: ServerDefaultHeterogeneousIngress): MiddlewareHandler =>
  async (c, next) => {
    if (process.env.ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT === '0') {
      throw new HTTPException(403, { message: 'Server-default agents are disabled' });
    }

    const bearerToken = extractBearerToken(c.req.header('Authorization'));
    const apiKeyToken = c.req.header('x-api-key')?.trim() || undefined;
    if (bearerToken && apiKeyToken) {
      throw new HTTPException(401, { message: 'Multiple operation credentials are not allowed' });
    }
    const token = bearerToken ?? apiKeyToken;
    const tokenHeader = bearerToken ? 'bearer' : apiKeyToken ? 'x-api-key' : undefined;
    const claims = token ? await validateHeteroOperationJWT(token) : null;
    if (!claims || !tokenHeader) {
      throw new HTTPException(401, { message: 'Invalid operation token' });
    }

    try {
      const db = await getServerDB();
      const principal = await resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims,
        db,
        operationId: claims.operation_id,
      });
      const agentType = principal.agentType;
      const config = getServerDefaultHeterogeneousAgentConfig(agentType);
      if (
        !agentType ||
        !config ||
        config.ingress !== ingress ||
        config.tokenHeader !== tokenHeader
      ) {
        throw new HTTPException(403, {
          message: 'Operation token cannot invoke this server model ingress',
        });
      }
      c.set('heteroAgentType', agentType);
      c.set('heteroOperationClaims', claims satisfies HeteroOperationJwtClaims);
      c.set('userId', principal.userId);
      c.set('workspaceId', principal.workspaceId);

      await next();
      if (!c.res.ok || !claims.model || !claims.provider_id) return;

      const relayInvocation = await new AgentOperationModel(
        db,
        principal.userId,
        principal.workspaceId,
      ).recordServerDefaultRelayInvocation(claims.operation_id, {
        acceptedAt: new Date().toISOString(),
        agentType,
        ingress,
        model: claims.model,
        operationId: claims.operation_id,
        provider: claims.provider_id,
      });
      if (!relayInvocation) {
        throw new HTTPException(409, {
          message: 'Server-default relay invocation could not be attested',
        });
      }
    } catch (error) {
      if (error instanceof HeteroOperationPrincipalError) {
        throw new HTTPException(error.status, { message: error.message });
      }
      throw error;
    }
  };
