import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { ApiKeyScope } from '@/const/apiKeyScope';
import { hasApiKeyScope } from '@/const/apiKeyScope';
import { RbacModel } from '@/database/models/rbac';
import type { LobeChatDatabase } from '@/database/type';

import { ERROR_NAME_TO_STATUS, TRPC_CODE_TO_STATUS } from '../common/base.controller';

/**
 * Who is calling the MCP endpoint, resolved by the same `userAuthMiddleware` and
 * `workspaceAuthMiddleware` every REST route runs behind.
 */
export interface McpCallContext {
  /** `undefined` unless API-key auth; `null` = full-access key. */
  apiKeyScopes: string[] | null | undefined;
  authType: string | null;
  db: LobeChatDatabase;
  /** Aborts when the client disconnects. */
  signal?: AbortSignal;
  userId: string;
  workspaceId?: string;
}

export const mcpContextFromHono = (c: Context, db: LobeChatDatabase): McpCallContext => ({
  apiKeyScopes: c.get('apiKeyScopes'),
  authType: c.get('authType') ?? null,
  db,
  signal: c.req.raw.signal,
  userId: c.get('userId'),
  workspaceId: c.get('workspaceId') || undefined,
});

/**
 * Does the caller's credential reach a capability that needs all of `scopes`?
 * OIDC tokens and full-access keys are not narrowed — the same rule as the
 * REST scope gates in `middleware/permission-check.ts`.
 */
export const allowsScopes = (ctx: McpCallContext, scopes: readonly string[]): boolean =>
  ctx.authType !== 'apikey' ||
  scopes.every((scope) => hasApiKeyScope(ctx.apiKeyScopes, scope as ApiKeyScope));

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

/**
 * One line a calling model can act on: the HTTP-equivalent status the REST
 * route would answer with, then the service's message.
 */
export const describeToolError = (error: unknown): { message: string; status: number } => {
  if (error instanceof HTTPException) return { message: error.message, status: error.status };
  if (error instanceof Error) {
    const status =
      error.name === 'TRPCError'
        ? TRPC_CODE_TO_STATUS[(error as Error & { code?: string }).code ?? '']
        : ERROR_NAME_TO_STATUS[error.name];
    return { message: error.message, status: status ?? 500 };
  }
  return { message: 'Internal Server Error', status: 500 };
};

/** An error `describeToolError` maps like the services' own (`NotFoundError` → 404). */
export const namedError = (name: string, message: string): Error =>
  Object.assign(new Error(message), { name });
