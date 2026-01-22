import type {
  AdapterAuthenticator,
  AdapterSession,
  AdapterUser,
  VerificationToken,
} from '@auth/core/adapters';
import debug from 'debug';
import { type Adapter, type AdapterAccount } from 'next-auth/adapters';
import urlJoin from 'url-join';

import { serverDBEnv } from '@/config/db';
import { appEnv } from '@/envs/app';

const log = debug('lobe-next-auth:adapter');

interface BackendAdapterResponse {
  data?: any;
  error?: string;
  success: boolean;
}

// Due to use direct HTTP Post, the date string cannot parse automatically
export const dateKeys = ['expires', 'emailVerified'];

/**
 * @description LobeNextAuthDbAdapter is implemented to handle the database operations for NextAuth
 * @returns {Adapter}
 */
export function LobeNextAuthDbAdapter(): Adapter {
  const baseUrl = appEnv.APP_URL;

  // Ensure the baseUrl is set, otherwise throw an error
  if (!baseUrl) {
    throw new Error('LobeNextAuthDbAdapter: APP_URL is not set in environment variables');
  }
  const interactionUrl = urlJoin(baseUrl, '/api/auth/adapter');
  log(`LobeNextAuthDbAdapter initialized with url: ${interactionUrl}`);

  // Ensure serverDBEnv.KEY_VAULTS_SECRET is set, otherwise throw an error
  if (!serverDBEnv.KEY_VAULTS_SECRET) {
    throw new Error('LobeNextAuthDbAdapter: KEY_VAULTS_SECRET is not set in environment variables');
  }

  const fetcher = (action: string, data: any) =>
    fetch(interactionUrl, {
      body: JSON.stringify({ action, data }),
      headers: {
        'Authorization': `Bearer ${serverDBEnv.KEY_VAULTS_SECRET}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  const postProcessor = async (res: Response) => {
    const data = (await res.json()) as BackendAdapterResponse;
    log('LobeNextAuthDbAdapter: postProcessor called with data:', data);
    if (!data.success) {
      log('LobeNextAuthDbAdapter: Error in postProcessor:');
      log(data);
      throw new Error(`LobeNextAuthDbAdapter: ${data.error}`);
    }
    if (data?.data) {
      for (const key of dateKeys) {
        if (data.data[key]) {
          data.data[key] = new Date(data.data[key]);
          continue;
        }
      }
    }
    return data.data;
  };

  return {
    async createAuthenticator(authenticator): Promise<AdapterAuthenticator> {
      const data = await fetcher('createAuthenticator', authenticator);
      return await postProcessor(data);
    },
    async createSession(session): Promise<AdapterSession> {
      const data = await fetcher('createSession', session);
      return await postProcessor(data);
    },
    async createUser(user): Promise<AdapterUser> {
      const data = await fetcher('createUser', user);
      return await postProcessor(data);
    },
    async createVerificationToken(data): Promise<VerificationToken | null | undefined> {
      const result = await fetcher('createVerificationToken', data);
      return await postProcessor(result);
    },
    async deleteSession(sessionToken): Promise<AdapterSession | null | undefined> {
      const result = await fetcher('deleteSession', sessionToken);
      await postProcessor(result);
      return;
    },
    async deleteUser(id): Promise<AdapterUser | null | undefined> {
      const result = await fetcher('deleteUser', id);
      await postProcessor(result);
      return;
    },

    async getAccount(providerAccountId, provider): Promise<AdapterAccount | null> {
      const data = await fetcher('getAccount', {
        provider,
        providerAccountId,
      });
      return await postProcessor(data);
    },

    async getAuthenticator(credentialID): Promise<AdapterAuthenticator | null> {
      const result = await fetcher('getAuthenticator', credentialID);
      return await postProcessor(result);
    },

    async getSessionAndUser(sessionToken): Promise<{
      session: AdapterSession;
      user: AdapterUser;
    } | null> {
      const result = await fetcher('getSessionAndUser', sessionToken);
      return await postProcessor(result);
    },

    async getUser(id): Promise<AdapterUser | null> {
      log('getUser called with id:', id);
      const result = await fetcher('getUser', id);
      return await postProcessor(result);
    },

    async getUserByAccount(account): Promise<AdapterUser | null> {
      const data = await fetcher('getUserByAccount', account);
      return await postProcessor(data);
    },

    async getUserByEmail(email): Promise<AdapterUser | null> {
      const data = await fetcher('getUserByEmail', email);
      return await postProcessor(data);
    },

    async linkAccount(data): Promise<AdapterAccount | null | undefined> {
      const result = await fetcher('linkAccount', data);
      return await postProcessor(result);
    },

    async listAuthenticatorsByUserId(userId): Promise<AdapterAuthenticator[]> {
      const result = await fetcher('listAuthenticatorsByUserId', userId);
      return await postProcessor(result);
    },

    // @ts-ignore: The return type is {Promise<void> | Awaitable<AdapterAccount | undefined>}
    async unlinkAccount(account): Promise<void | AdapterAccount | undefined> {
      const result = await fetcher('unlinkAccount', account);
      await postProcessor(result);
      return;
    },

    async updateAuthenticatorCounter(credentialID, counter): Promise<AdapterAuthenticator> {
      const result = await fetcher('updateAuthenticatorCounter', {
        counter,
        credentialID,
      });
      return await postProcessor(result);
    },

    async updateSession(data): Promise<AdapterSession | null | undefined> {
      const result = await fetcher('updateSession', data);
      return await postProcessor(result);
    },

    async updateUser(user): Promise<AdapterUser> {
      const result = await fetcher('updateUser', user);
      return await postProcessor(result);
    },

    async useVerificationToken(identifier_token): Promise<VerificationToken | null> {
      const result = await fetcher('useVerificationToken', identifier_token);
      return await postProcessor(result);
    },
  };
}
