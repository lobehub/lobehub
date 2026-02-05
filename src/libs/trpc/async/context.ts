import type {LobeChatDatabase} from '@lobechat/database';
import debug from 'debug';
import type {NextRequest} from 'next/server';

import { LOBE_CHAT_AUTH_HEADER } from '@/envs/auth';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

const log = debug('lobe-async:context');

export interface AsyncAuthContext {
  authorizationToken?: string;
  serverDB?: LobeChatDatabase;
  userId?: string | null;
}

/**
 * Inner function for `createContext` where we create the context.
 * This is useful for testing when we don't want to mock Next.js' request/response
 */
export const createAsyncContextInner = async (params?: {
  authorizationToken?: string;
  userId?: string | null;
}): Promise<AsyncAuthContext> => ({
  authorizationToken: params?.authorizationToken,
  userId: params?.userId,
});

export type AsyncContext = Awaited<ReturnType<typeof createAsyncContextInner>>;

export const createAsyncRouteContext = async (request: NextRequest): Promise<AsyncContext> => {
  // for API-response caching see https://trpc.io/docs/v11/caching

  log('Creating async route context');

  const authorization = request.headers.get('Authorization');
  const lobeChatAuthorization = request.headers.get(LOBE_CHAT_AUTH_HEADER);

  log('Authorization header present: %s', !!authorization);
  log('LobeChat auth header present: %s', !!lobeChatAuthorization);

  if (!authorization) {
    log('No authorization header found');
    throw new Error('No authorization header found');
  }

  if (!lobeChatAuthorization) {
    log('No LobeChat authorization header found');
    throw new Error('No LobeChat authorization header found');
  }

  try {
    log('Initializing KeyVaultsGateKeeper');
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    log('Decrypting LobeChat authorization');
    const { plaintext } = await gateKeeper.decrypt(lobeChatAuthorization);

    log('Parsing decrypted authorization data');
    const { userId } = JSON.parse(plaintext);

    log('Successfully parsed authorization data - userId: %s', userId);

    return createAsyncContextInner({ authorizationToken: authorization, userId });
  } catch (error) {
    log('Error creating async route context: %O', error);
    throw error;
  }
};
