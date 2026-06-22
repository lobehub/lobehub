import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';

import type { LambdaRouter } from '@/server/routers/lambda';
import type { ToolsRouter } from '@/server/routers/tools';

import { getValidToken } from '../auth/refresh';
import { CLI_API_KEY_ENV } from '../constants/auth';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';

export type TrpcClient = ReturnType<typeof createTRPCClient<LambdaRouter>>;
export type ToolsTrpcClient = ReturnType<typeof createTRPCClient<ToolsRouter>>;

const PERSONAL_KEY = '__personal__';
const _clients = new Map<string, TrpcClient>();
let _toolsClient: ToolsTrpcClient | undefined;

async function getAuthAndServer() {
  // LOBEHUB_JWT + LOBEHUB_SERVER env vars (used by server-side sandbox execution)
  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) {
    const serverUrl = resolveServerUrl();

    return {
      headers: { 'Oidc-Auth': envJwt },
      serverUrl,
    };
  }

  const envApiKey = process.env[CLI_API_KEY_ENV];
  if (envApiKey) {
    const serverUrl = resolveServerUrl();

    return {
      headers: { 'X-API-Key': envApiKey },
      serverUrl,
    };
  }

  const result = await getValidToken();
  if (!result) {
    log.error(
      `No authentication found. Run 'lh login' (or 'npx -y @lobehub/cli login') first, or set ${CLI_API_KEY_ENV}.`,
    );
    process.exit(1);
  }

  const serverUrl = resolveServerUrl();

  return {
    headers: { 'Oidc-Auth': result.credentials.accessToken },
    serverUrl,
  };
}

/**
 * Resolve the workspace scope for outbound tRPC calls.
 *
 * Precedence: explicit caller arg → `LOBEHUB_WORKSPACE_ID` env (inherited
 * from a workspace-dispatched parent process, e.g. openclaw spawned by the
 * device's `runHeteroTask`) → personal mode. Without this, agentNotify
 * callbacks on workspace topics would resolve through personal-mode
 * TopicModel and 404.
 */
function resolveWorkspaceId(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const fromEnv = process.env.LOBEHUB_WORKSPACE_ID;
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export async function getTrpcClient(workspaceId?: string): Promise<TrpcClient> {
  const wsId = resolveWorkspaceId(workspaceId);
  const cacheKey = wsId ?? PERSONAL_KEY;
  const cached = _clients.get(cacheKey);
  if (cached) return cached;

  const { headers, serverUrl } = await getAuthAndServer();
  const client = createTRPCClient<LambdaRouter>({
    links: [
      httpLink({
        headers: wsId ? { ...headers, 'X-Workspace-Id': wsId } : headers,
        transformer: superjson,
        url: `${serverUrl}/trpc/lambda`,
      }),
    ],
  });
  _clients.set(cacheKey, client);

  return client;
}

/**
 * Build a Lambda tRPC client from an already-resolved auth context, without
 * re-running credential discovery. Use this when the caller already holds a
 * token (e.g. `lh connect --token <jwt>`) — `getTrpcClient` would re-resolve
 * via env/stored creds and `process.exit(1)` when none exist, which would
 * abort an otherwise-valid explicit-token session.
 */
export function createLambdaClient(
  auth: {
    serverUrl: string;
    token: string;
    tokenType: 'apiKey' | 'jwt' | 'serviceToken';
  },
  /** When set, scopes the request to a workspace (e.g. workspace-device enrollment). */
  workspaceId?: string,
): TrpcClient {
  const headers: Record<string, string> = {
    ...(auth.tokenType === 'apiKey' ? { 'X-API-Key': auth.token } : { 'Oidc-Auth': auth.token }),
    ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
  };

  return createTRPCClient<LambdaRouter>({
    links: [httpLink({ headers, transformer: superjson, url: `${auth.serverUrl}/trpc/lambda` })],
  });
}

export async function getToolsTrpcClient(): Promise<ToolsTrpcClient> {
  if (_toolsClient) return _toolsClient;

  const { headers, serverUrl } = await getAuthAndServer();
  _toolsClient = createTRPCClient<ToolsRouter>({
    links: [
      httpLink({
        headers,
        transformer: superjson,
        url: `${serverUrl}/trpc/tools`,
      }),
    ],
  });

  return _toolsClient;
}
