import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';
import { getAgentStreamAuthInfo } from './http';
import { isOperationToken, storedLoginFor } from './operationTokenFallback';
import { withWorkspaceHeader } from './workspace';

/**
 * The Bearer token for `/api/v1/*`. That API accepts OIDC JWTs and API keys
 * but refuses a run's `hetero-operation` token outright, so an operation token
 * in `LOBEHUB_JWT` is swapped for this machine's stored login of the same
 * account, the same rule `operationTokenFallbackLink` applies to tRPC.
 */
const resolveBearerToken = async (): Promise<string> => {
  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt && isOperationToken(envJwt)) {
    const lookup = await storedLoginFor(envJwt);
    if ('token' in lookup) return lookup.token;

    log.error(lookup.warning);
    process.exit(1);
  }

  return (await getAgentStreamAuthInfo()).token;
};

/**
 * GET a LobeHub REST API (`/api/v1/*`) resource and unwrap its `data`
 * envelope. The workspace scope resolves like every other command.
 */
export async function getOpenApi<T>(path: string, workspaceId?: string): Promise<T> {
  const token = await resolveBearerToken();

  const res = await fetch(`${resolveServerUrl()}/api/v1${path}`, {
    headers: withWorkspaceHeader({ Authorization: `Bearer ${token}` }, workspaceId),
  });
  const body = (await res.json().catch(() => undefined)) as
    { data?: T; error?: string; success?: boolean } | undefined;

  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `GET /api/v1${path} failed with HTTP ${res.status}`);
  }

  return body.data as T;
}
