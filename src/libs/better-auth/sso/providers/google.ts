import { authEnv } from '@/envs/auth';

import { type BuiltinProviderDefinition } from '../types';

const provider: BuiltinProviderDefinition<
  {
    AUTH_GOOGLE_ID: string;
    AUTH_GOOGLE_SECRET: string;
  },
  'google'
> = {
  build: (env) => {
    return {
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
    };
  },
  checkEnvs: () => {
    return !!(authEnv.AUTH_GOOGLE_ID && authEnv.AUTH_GOOGLE_SECRET)
      ? {
          AUTH_GOOGLE_ID: authEnv.AUTH_GOOGLE_ID,
          AUTH_GOOGLE_SECRET: authEnv.AUTH_GOOGLE_SECRET,
        }
      : false;
  },
  id: 'google',
  type: 'builtin',
};

export default provider;
