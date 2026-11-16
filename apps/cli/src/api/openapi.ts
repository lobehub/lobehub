import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';
import { getAgentStreamAuthInfo } from './http';
import { isOperationToken } from './operationToken';
import { withWorkspaceHeader } from './workspace';

/**
 * The Bearer token for `/api/v1/*`. That API accepts OIDC JWTs and API keys
 * but refuses a run's `hetero-operation` token outright, and `lh` does not
 * swap in this machine's own login for it (see `operationToken`).
 */
const resolveBearerToken = async (): Promise<string> => {
  if (isOperationToken(process.env.LOBEHUB_JWT)) {
    log.error(
      "This command is not available inside an agent run: its LobeHub API does not accept the run's sign-in. Ask the user to run it in a terminal.",
    );
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
