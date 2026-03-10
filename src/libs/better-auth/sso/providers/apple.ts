import { authEnv } from '@/envs/auth';

import { type BuiltinProviderDefinition } from '../types';

const provider: BuiltinProviderDefinition<
  {
    AUTH_APPLE_APP_BUNDLE_IDENTIFIER?: string;
    AUTH_APPLE_CLIENT_ID: string;
    AUTH_APPLE_CLIENT_SECRET: string;
  },
  'apple'
> = {
  build: (env) => {
    return {
      appBundleIdentifier: env.AUTH_APPLE_APP_BUNDLE_IDENTIFIER,
      clientId: env.AUTH_APPLE_CLIENT_ID,
      clientSecret: env.AUTH_APPLE_CLIENT_SECRET,
    };
  },
  checkEnvs: () => {
    return !!(authEnv.AUTH_APPLE_CLIENT_ID && authEnv.AUTH_APPLE_CLIENT_SECRET)
      ? {
          AUTH_APPLE_APP_BUNDLE_IDENTIFIER: authEnv.AUTH_APPLE_APP_BUNDLE_IDENTIFIER,
          AUTH_APPLE_CLIENT_ID: authEnv.AUTH_APPLE_CLIENT_ID,
          AUTH_APPLE_CLIENT_SECRET: authEnv.AUTH_APPLE_CLIENT_SECRET,
        }
      : false;
  },
  id: 'apple',
  type: 'builtin',
};

export default provider;
