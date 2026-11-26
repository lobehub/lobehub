import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import urlJoin from 'url-join';

import { appEnv } from '@/envs/app';
import { LOBE_CHAT_AUTH_HEADER } from '@/envs/auth';
import { signInternalJWT } from '@/libs/trpc/utils/internalJwt';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

// Type-only on purpose: services the async routes use can import this caller without a cycle.
import type { AsyncRouter } from './index';

export const createAsyncServerClient = async (userId: string) => {
  const token = await signInternalJWT();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const headers: Record<string, string> = {
    Authorization: token,
    [LOBE_CHAT_AUTH_HEADER]: await gateKeeper.encrypt(JSON.stringify({ userId })),
  };

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  const client = createTRPCClient<AsyncRouter>({
    links: [
      httpLink({
        headers,
        transformer: superjson,
        // Use INTERNAL_APP_URL for server-to-server calls to bypass CDN/proxy
        url: urlJoin(appEnv.INTERNAL_APP_URL!, '/trpc/async'),
      }),
    ],
  });

  return client;
};

export type UnifiedAsyncCaller = ReturnType<AsyncRouter['createCaller']>;

interface CreateCallerOptions {
  userId: string;
}

/**
 * Factory method for creating caller, using HTTP Client to make calls
 * Unified usage pattern: caller.a.b()
 */
export const createAsyncCaller = async (
  options: CreateCallerOptions,
): Promise<UnifiedAsyncCaller> => {
  const { userId } = options;

  const httpClient = await createAsyncServerClient(userId);
  const createRecursiveProxy = (client: any, path: string[]): any => {
    // The target is a dummy function, so that 'apply' can be triggered.
    return new Proxy(() => {}, {
      apply: (_target, _thisArg, args) => {
        // 'apply' is triggered by the function call `(...)`.
        // The `path` at this point is the full path to the procedure.

        // Traverse the original httpClient to get the actual procedure object.
        const procedure = path.reduce((obj, key) => (obj ? obj[key] : undefined), client);

        if (procedure && typeof procedure.mutate === 'function') {
          // If we found a valid procedure, call its mutate method.
          return procedure.mutate(...args);
        } else {
          // This should not happen if the call path is correct.
          const message = `Procedure not found or not valid at path: ${path.join('.')}`;
          throw new Error(message);
        }
      },
      get: (_, property: string) => {
        // When a property is accessed, we just extend the path and return a new proxy.
        // This handles `caller.file.parseFileToChunks`
        if (property === 'then') return undefined; // Prevent async/await issues
        return createRecursiveProxy(client, [...path, property as string]);
      },
    });
  };

  return createRecursiveProxy(httpClient, []);
};
