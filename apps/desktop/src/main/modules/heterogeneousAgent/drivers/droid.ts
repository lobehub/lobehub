import path from 'node:path';

import { buildDroidAcpArgs } from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import type { HeterogeneousAgentDriver } from '../types';

/** Factory Droid prompts run through its native bidirectional ACP session. */
export const droidDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return { args: buildDroidAcpArgs(args) };
  },
  prepareServerDefaultBinding({ args, endpoint, env, model, modelDescriptor, profileDir }) {
    const bindingEnv = { ...env };
    delete bindingEnv.LOBEHUB_DROID_API_KEY;
    const customModel = {
      apiKey: '${LOBEHUB_DROID_API_KEY}',
      baseUrl: `${endpoint}/api/v1/anthropic`,
      displayName: 'LobeHub Server Default',
      maxOutputTokens:
        modelDescriptor?.maxOutput && modelDescriptor.maxOutput > 0
          ? modelDescriptor.maxOutput
          : 16_384,
      model: formatServerDefaultHeterogeneousModel(model),
      noImageSupport: modelDescriptor?.abilities.vision !== true,
      provider: 'anthropic',
    };
    return {
      args,
      env: bindingEnv,
      model: 'custom:LobeHub-Server-Default-0',
      operationTokenEnvKey: 'LOBEHUB_DROID_API_KEY',
      profileFiles: [
        {
          content: `${JSON.stringify({ customModels: [customModel] }, null, 2)}\n`,
          path: 'settings.json',
        },
      ],
      settingsPath: path.join(profileDir, 'settings.json'),
    };
  },
};
