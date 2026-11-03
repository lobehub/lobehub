import { authEnv } from '@/envs/auth';

import { type BuiltinProviderDefinition } from '../types';

const provider: BuiltinProviderDefinition<
  {
    AUTH_COGNITO_DOMAIN: string;
    AUTH_COGNITO_ID: string;
    AUTH_COGNITO_REGION: string;
    AUTH_COGNITO_SECRET: string;
    AUTH_COGNITO_USERPOOL_ID: string;
  },
  'cognito'
> = {
  build: (env) => {
    return {
      clientId: env.AUTH_COGNITO_ID,
      clientSecret: env.AUTH_COGNITO_SECRET,
      domain: env.AUTH_COGNITO_DOMAIN,
      region: env.AUTH_COGNITO_REGION,
      userPoolId: env.AUTH_COGNITO_USERPOOL_ID,
    };
  },
  checkEnvs: () => {
    return !!(
      authEnv.AUTH_COGNITO_ID &&
      authEnv.AUTH_COGNITO_SECRET &&
      authEnv.AUTH_COGNITO_DOMAIN &&
      authEnv.AUTH_COGNITO_REGION &&
      authEnv.AUTH_COGNITO_USERPOOL_ID
    )
      ? {
          AUTH_COGNITO_DOMAIN: authEnv.AUTH_COGNITO_DOMAIN,
          AUTH_COGNITO_ID: authEnv.AUTH_COGNITO_ID,
          AUTH_COGNITO_REGION: authEnv.AUTH_COGNITO_REGION,
          AUTH_COGNITO_SECRET: authEnv.AUTH_COGNITO_SECRET,
          AUTH_COGNITO_USERPOOL_ID: authEnv.AUTH_COGNITO_USERPOOL_ID,
        }
      : false;
  },
  id: 'cognito',
  type: 'builtin',
};

export default provider;
