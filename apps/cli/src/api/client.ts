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

let _client: TrpcClient | undefined;
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

export async function getTrpcClient(): Promise<TrpcClient> {
  if (_client) return _client;

  const { headers, serverUrl } = await getAuthAndServer();
  _client = createTRPCClient<LambdaRouter>({
    links: [
      httpLink({
        headers,
        transformer: superjson,
        url: `${serverUrl}/trpc/lambda`,
      }),
    ],
  });

  return _client;
}

/**
 * Build a Lambda tRPC client from an already-resolved auth context, without
 * re-running credential discovery. Use this when the caller already holds a
 * token (e.g. `lh connect --token <jwt>`) — `getTrpcClient` would re-resolve
 * via env/stored creds and `process.exit(1)` when none exist, which would
 * abort an otherwise-valid explicit-token session.
 */
export function createLambdaClient(auth: {
  serverUrl: string;
  token: string;
  tokenType: 'apiKey' | 'jwt' | 'serviceToken';
}): TrpcClient {
  const headers =
    auth.tokenType === 'apiKey' ? { 'X-API-Key': auth.token } : { 'Oidc-Auth': auth.token };

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
