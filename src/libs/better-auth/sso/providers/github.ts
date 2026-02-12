import { authEnv } from '@/envs/auth';

import { type BuiltinProviderDefinition } from '../types';

const provider: BuiltinProviderDefinition<
  {
    AUTH_GITHUB_ID: string;
    AUTH_GITHUB_SECRET: string;
  },
  'github'
> = {
  build: (env) => {
    return {
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
    };
  },
  checkEnvs: () => {
    return !!(authEnv.AUTH_GITHUB_ID && authEnv.AUTH_GITHUB_SECRET)
      ? {
          AUTH_GITHUB_ID: authEnv.AUTH_GITHUB_ID,
          AUTH_GITHUB_SECRET: authEnv.AUTH_GITHUB_SECRET,
        }
      : false;
  },
  id: 'github',
  type: 'builtin',
};

export default provider;
