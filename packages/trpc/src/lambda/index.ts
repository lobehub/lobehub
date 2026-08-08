/**
 * This is your entry point to setup the root configuration for tRPC on the server.
 * - `initTRPC` should only be used once per app.
 * - We export only the functionality that we use so we can enforce which base procedures should be used
 *
 * Learn how to create protected base procedures and other things below:
 * @link https://trpc.io/docs/v11/router
 * @link https://trpc.io/docs/v11/procedures
 */

import { openTelemetry } from '../middleware/openTelemetry';
import { userAuth } from '../middleware/userAuth';
import { trpc } from './init';
import { apiKeyScopeGuard } from './middleware/apiKeyScope';
import { heteroOperationAuth } from './middleware/heteroOperationAuth';
import { oidcAuth } from './middleware/oidcAuth';

/**
 * Create a router
 * @link https://trpc.io/docs/v11/router
 */
export const router = trpc.router;

/**
 * Create an unprotected procedure
 * @link https://trpc.io/docs/v11/procedures
 **/
const baseProcedure = trpc.procedure.use(openTelemetry);

// `apiKeyScopeGuard` also covers public procedures: `createLambdaContext`
// authenticates an `X-API-Key` before procedure selection, and several public
// procedures serve authenticated data off `ctx.userId`. The guard is a no-op
// without API-key auth, so anonymous access is untouched.
export const publicProcedure = baseProcedure.use(apiKeyScopeGuard);

// procedure that asserts that the user is logged in
// `apiKeyScopeGuard` narrows API-key-authenticated calls to the key's scopes;
// session/OIDC auth and full-access keys pass through untouched.
export const authedProcedure = baseProcedure.use(oidcAuth).use(userAuth).use(apiKeyScopeGuard);

// procedure for hetero-agent ingest/finish endpoints — requires a `hetero-operation` JWT
export const heteroAuthedProcedure = baseProcedure.use(heteroOperationAuth).use(userAuth);

/**
 * Create a server-side caller
 * @link https://trpc.io/docs/v11/server/server-side-calls
 */
export const createCallerFactory = trpc.createCallerFactory;
