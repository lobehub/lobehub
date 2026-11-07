import { authEnv } from '@/envs/auth';

import { type BuiltinProviderDefinition } from '../types';

/**
 * X (Twitter) is link-only: users connect it from profile settings so an X user id can be
 * mapped to an account. Sign-in is rejected by the
 * `linkOnlyProviders` plugin; `disableSignUp` is a second guard against account creation.
 */
const provider: BuiltinProviderDefinition<
  {
    AUTH_TWITTER_ID: string;
    AUTH_TWITTER_SECRET: string;
  },
  'twitter'
> = {
  build: (env) => {
    return {
      clientId: env.AUTH_TWITTER_ID,
      clientSecret: env.AUTH_TWITTER_SECRET,
      disableSignUp: true,
      /**
       * Only the identity is needed. The default scopes also request `users.email` and
       * `offline.access`, which require extra X app permissions and are never used.
       * `GET /2/users/me` requires both `users.read` and `tweet.read`.
       */
      disableDefaultScope: true,
      scope: ['users.read', 'tweet.read'],
    };
  },
  checkEnvs: () => {
    return !!(authEnv.AUTH_TWITTER_ID && authEnv.AUTH_TWITTER_SECRET)
      ? {
          AUTH_TWITTER_ID: authEnv.AUTH_TWITTER_ID,
          AUTH_TWITTER_SECRET: authEnv.AUTH_TWITTER_SECRET,
        }
      : false;
  },
  id: 'twitter',
  type: 'builtin',
};

export default provider;
