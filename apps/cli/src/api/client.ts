import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';

import type { LambdaRouter } from '@/server/routers/lambda';

import { getValidToken } from '../auth/refresh';
import { log } from '../utils/logger';

export type TrpcClient = ReturnType<typeof createTRPCClient<LambdaRouter>>;

let _client: TrpcClient | undefined;

export async function getTrpcClient(): Promise<TrpcClient> {
  if (_client) return _client;

  const result = await getValidToken();
  if (!result) {
    log.error("No authentication found. Run 'lh login' first.");
    process.exit(1);
  }

  const { serverUrl, accessToken } = result.credentials;

  _client = createTRPCClient<LambdaRouter>({
    links: [
      httpLink({
        headers: {
          'Oidc-Auth': accessToken,
        },
        transformer: superjson,
        url: `${serverUrl.replace(/\/$/, '')}/trpc/lambda`,
      }),
    ],
  });

  return _client;
}
