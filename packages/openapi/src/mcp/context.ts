import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { ApiKeyScope } from '@/const/apiKeyScope';
import { hasApiKeyScope } from '@/const/apiKeyScope';
import { RbacModel } from '@/database/models/rbac';
import type { LobeChatDatabase } from '@/database/type';

import { TRPC_CODE_TO_STATUS } from '../common/base.controller';

/**
 * Who is calling the MCP endpoint, resolved by the same `userAuthMiddleware` and
 * `workspaceAuthMiddleware` every REST route runs behind.
 */
export interface McpCallContext {
  /** `undefined` unless API-key auth; `null` = full-access key. */
  apiKeyScopes: string[] | null | undefined;
  authType: string | null;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

export const mcpContextFromHono = (c: Context, db: LobeChatDatabase): McpCallContext => ({
  apiKeyScopes: c.get('apiKeyScopes'),
  authType: c.get('authType') ?? null,
  db,
  userId: c.get('userId'),
  workspaceId: c.get('workspaceId') || undefined,
});

/**
 * Does the caller's credential reach a capability that needs all of `scopes`?
 * OIDC tokens and full-access keys are not narrowed — the same rule as the
 * REST scope gates in `middleware/permission-check.ts`.
 */
export const allowsScopes = (ctx: McpCallContext, scopes: readonly ApiKeyScope[]): boolean =>
  ctx.authType !== 'apikey' || scopes.every((scope) => hasApiKeyScope(ctx.apiKeyScopes, scope));

/**
 * The caller's own RBAC, checked with the permission codes the matching REST
 * route declares: each group must have at least one granted code.
 */
export const assertPermissions = async (
  ctx: McpCallContext,
  groups: readonly (readonly string[])[],
): Promise<void> => {
  const rbac = new RbacModel(ctx.db, ctx.userId);
  for (const codes of groups) {
    const granted = await rbac.hasAnyPermission([...codes], {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    if (!granted) {
      throw new HTTPException(403, {
        message: `Insufficient permissions. Required: ${codes.join(' OR ')}`,
      });
    }
  }
};

/** HTTP status a service error stands for, as `BaseController.handleError` maps it. */
const ERROR_NAME_TO_STATUS: Record<string, number> = {
  AuthenticationError: 401,
  AuthorizationError: 403,
  BusinessError: 400,
  ConflictError: 409,
  NotFoundError: 404,
  ValidationError: 400,
};

/**
 * One line a calling model can act on: the HTTP-equivalent status the REST
 * route would answer with, then the service's message.
 */
export const describeToolError = (error: unknown): string => {
  if (error instanceof HTTPException) return `${error.status}: ${error.message}`;
  if (error instanceof Error) {
    const status =
      error.name === 'TRPCError'
        ? TRPC_CODE_TO_STATUS[(error as Error & { code?: string }).code ?? '']
        : ERROR_NAME_TO_STATUS[error.name];
    return status ? `${status}: ${error.message}` : `500: ${error.message}`;
  }
  return '500: Internal Server Error';
};

/** An error `describeToolError` maps like the services' own (`NotFoundError` → 404). */
export const namedError = (name: keyof typeof ERROR_NAME_TO_STATUS, message: string): Error =>
  Object.assign(new Error(message), { name });
