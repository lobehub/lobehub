import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';

import type { LambdaRouter } from '@/server/routers/lambda';
import type { ToolsRouter } from '@/server/routers/tools';

import { getValidToken } from '../auth/refresh';
import { CLI_API_KEY_ENV, readCliApiKeyEnv } from '../constants/auth';
import { CLI_PRIMARY_BIN } from '../constants/identity';
import { cliPackageName } from '../pkg';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';
import { resolveWorkspaceId, withWorkspaceHeader } from './workspace';

export type TrpcClient = ReturnType<typeof createTRPCClient<LambdaRouter>>;
export type ToolsTrpcClient = ReturnType<typeof createTRPCClient<ToolsRouter>>;

const PERSONAL_KEY = '__personal__';
const _clients = new Map<string, TrpcClient>();
const _toolsClients = new Map<string, ToolsTrpcClient>();

async function getAuthAndServer(): Promise<{ headers: Record<string, string>; serverUrl: string }> {
  // LOBEHUB_JWT + LOBEHUB_SERVER env vars (used by server-side sandbox execution)
  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) {
    const serverUrl = resolveServerUrl();

    return {
      headers: { 'Oidc-Auth': envJwt },
      serverUrl,
    };
  }

  const envApiKey = readCliApiKeyEnv();
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
      `No authentication found. Run '${CLI_PRIMARY_BIN} login' (or 'npx -y ${cliPackageName} login') first, or set ${CLI_API_KEY_ENV}.`,
    );
    process.exit(1);
  }

  const serverUrl = resolveServerUrl();

  return {
    headers: { 'Oidc-Auth': result.credentials.accessToken },
    serverUrl,
  };
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
        headers: withWorkspaceHeader(headers, wsId),
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
  };

  return createTRPCClient<LambdaRouter>({
    links: [
      httpLink({
        headers: workspaceId ? { ...headers, 'X-Workspace-Id': workspaceId } : headers,
        transformer: superjson,
        url: `${auth.serverUrl}/trpc/lambda`,
      }),
    ],
  });
}

/**
 * Same workspace scoping as `getTrpcClient` — the tools router is workspace
 * aware too, and dropping the header here silently ran every tools call
 * (web/local search, market) against personal scope, which also mis-attributes
 * the spend.
 */
export async function getToolsTrpcClient(workspaceId?: string): Promise<ToolsTrpcClient> {
  const wsId = resolveWorkspaceId(workspaceId);
  const cacheKey = wsId ?? PERSONAL_KEY;
  const cached = _toolsClients.get(cacheKey);
  if (cached) return cached;

  const { headers, serverUrl } = await getAuthAndServer();
  const client = createTRPCClient<ToolsRouter>({
    links: [
      httpLink({
        headers: withWorkspaceHeader(headers, wsId),
        transformer: superjson,
        url: `${serverUrl}/trpc/tools`,
      }),
    ],
  });
  _toolsClients.set(cacheKey, client);

  return client;
}
