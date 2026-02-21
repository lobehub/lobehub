import { authEnv } from '@/envs/auth';

import { type BuiltinProviderDefinition } from '../types';

type MicrosoftEnv = {
  AUTH_MICROSOFT_AUTHORITY_URL?: string;
  AUTH_MICROSOFT_ID: string;
  AUTH_MICROSOFT_SECRET: string;
  AUTH_MICROSOFT_TENANT_ID?: string;
};

const provider: BuiltinProviderDefinition<MicrosoftEnv, 'microsoft'> = {
  aliases: ['microsoft-entra-id'],
  build: (env) => ({
    authority: env.AUTH_MICROSOFT_AUTHORITY_URL,
    clientId: env.AUTH_MICROSOFT_ID,
    clientSecret: env.AUTH_MICROSOFT_SECRET,
    tenantId: env.AUTH_MICROSOFT_TENANT_ID,
  }),
  checkEnvs: () => {
    const clientId = authEnv.AUTH_MICROSOFT_ID;
    const clientSecret = authEnv.AUTH_MICROSOFT_SECRET;
    const tenantId = authEnv.AUTH_MICROSOFT_TENANT_ID;
    return !!(clientId && clientSecret)
      ? {
          AUTH_MICROSOFT_AUTHORITY_URL: authEnv.AUTH_MICROSOFT_AUTHORITY_URL,
          AUTH_MICROSOFT_ID: clientId,
          AUTH_MICROSOFT_SECRET: clientSecret,
          AUTH_MICROSOFT_TENANT_ID: tenantId,
        }
      : false;
  },
  id: 'microsoft',
  type: 'builtin',
};

export default provider;
