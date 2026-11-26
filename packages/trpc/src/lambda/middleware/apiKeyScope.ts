import {
  hasApiKeyScope,
  isFullAccessApiKey,
  requiredApiKeyScopeForTrpc,
} from '@lobechat/const/apiKeyScope';
import { TRPCError } from '@trpc/server';

import { trpc } from '../init';

/** What a device run's caller token is told when its scopes do not cover a route. */
const callerRunRefusal = (path: string) =>
  `An agent run cannot access '${path}' with its own token: agent runs are limited to tasks, documents, files, acceptance, bot messages, the device list and traces. Ask the user to do this in LobeHub.`;

/**
 * Global capability-scope guard for API-key-authenticated requests.
 *
 * Applies to every `authedProcedure` without touching individual routers: the
 * required scope is derived from the router namespace + operation type via
 * `TRPC_NAMESPACE_API_KEY_RULES`.
 *
 * - Session / OIDC auth (`ctx.apiKeyScopes === undefined`) → untouched.
 * - Full-access keys (legacy `NULL` scopes, or `['*']`) → untouched.
 * - Restricted keys → the namespace must be registered and grant a scope the
 *   key holds; unknown namespaces are denied (fail closed), so newly added
 *   routers are never silently exposed to restricted keys.
 * - A device run's `caller:act` token → limited the same way, to
 *   `HETERO_CALLER_SCOPES` (`oidcAuth`).
 */
export const apiKeyScopeGuard = trpc.middleware(async ({ ctx, path, type, next }) => {
  const scopes = ctx.apiKeyScopes;

  // not API-key auth, or a full-access key: scope enforcement does not apply
  if (scopes === undefined || isFullAccessApiKey(scopes)) return next();

  const decision = requiredApiKeyScopeForTrpc(path, type);

  if ('open' in decision) return next();

  // A device run's caller token is limited the same way (`oidcAuth`); its
  // refusal is read by the agent, so it says what to do instead.
  const callerRun = ctx.oidcAuth?.purpose === 'hetero-operation';

  if ('blocked' in decision) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: callerRun
        ? callerRunRefusal(path)
        : `This API key cannot access '${path}': the operation is not available to restricted API keys.`,
    });
  }

  const missing = decision.scopes.filter((scope) => !hasApiKeyScope(scopes, scope));
  if (missing.length > 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: callerRun
        ? callerRunRefusal(path)
        : `This API key cannot access '${path}': missing required scope '${missing.join("', '")}'.`,
    });
  }

  return next();
});
