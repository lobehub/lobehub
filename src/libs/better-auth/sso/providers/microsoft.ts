import { authEnv } from '@/envs/auth';

import type { BuiltinProviderDefinition } from '../types';

type MicrosoftEnv = {
  AUTH_MICROSOFT_ID?: string;
  AUTH_MICROSOFT_SECRET?: string;
};

const provider: BuiltinProviderDefinition<MicrosoftEnv, 'microsoft'> = {
  aliases: ['microsoft-entra-id'],
  build: (env) => ({
    clientId: env.AUTH_MICROSOFT_ID!,
    clientSecret: env.AUTH_MICROSOFT_SECRET!,
  }),
  checkEnvs: () => {
    const clientId = authEnv.AUTH_MICROSOFT_ID;
    const clientSecret = authEnv.AUTH_MICROSOFT_SECRET;
    return !!(clientId && clientSecret)
      ? {
          AUTH_MICROSOFT_ID: clientId,
          AUTH_MICROSOFT_SECRET: clientSecret,
        }
      : false;
  },
  id: 'microsoft',
  type: 'builtin',
};

export default provider;
