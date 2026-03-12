import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';

import type { LambdaRouter } from '@/server/routers/lambda';
import type { ToolsRouter } from '@/server/routers/tools';

import { getValidToken } from '../auth/refresh';
import { OFFICIAL_SERVER_URL } from '../constants/urls';
import { loadSettings } from '../settings';
import { log } from '../utils/logger';

export type TrpcClient = ReturnType<typeof createTRPCClient<LambdaRouter>>;
export type ToolsTrpcClient = ReturnType<typeof createTRPCClient<ToolsRouter>>;

let _client: TrpcClient | undefined;
let _toolsClient: ToolsTrpcClient | undefined;

async function getAuthAndServer() {
  // LOBEHUB_JWT + LOBEHUB_SERVER env vars (used by server-side sandbox execution)
  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) {
    const serverUrl = process.env.LOBEHUB_SERVER || OFFICIAL_SERVER_URL;
    return { accessToken: envJwt, serverUrl: serverUrl.replace(/\/$/, '') };
  }

  const result = await getValidToken();
  if (!result) {
    log.error("No authentication found. Run 'lh login' first.");
    process.exit(1);
  }

  const accessToken = result.credentials.accessToken;
  const serverUrl = loadSettings()?.serverUrl || OFFICIAL_SERVER_URL;

  return { accessToken, serverUrl: serverUrl.replace(/\/$/, '') };
}

export async function getTrpcClient(): Promise<TrpcClient> {
  if (_client) return _client;

  const { accessToken, serverUrl } = await getAuthAndServer();

  _client = createTRPCClient<LambdaRouter>({
    links: [
      httpLink({
        headers: { 'Oidc-Auth': accessToken },
        transformer: superjson,
        url: `${serverUrl}/trpc/lambda`,
      }),
    ],
  });

  return _client;
}

export async function getToolsTrpcClient(): Promise<ToolsTrpcClient> {
  if (_toolsClient) return _toolsClient;

  const { accessToken, serverUrl } = await getAuthAndServer();

  _toolsClient = createTRPCClient<ToolsRouter>({
    links: [
      httpLink({
        headers: { 'Oidc-Auth': accessToken },
        transformer: superjson,
        url: `${serverUrl}/trpc/tools`,
      }),
    ],
  });

  return _toolsClient;
}
