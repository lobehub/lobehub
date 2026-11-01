import path from 'node:path';

import { OPENCODE_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const TOKEN_ENV = 'LOBEHUB_OPENCODE_API_KEY';
const PROVIDER = 'lobehub-server-default';
const CONTROLLED_VALUE_FLAGS = [
  '--model',
  '-m',
  '--session',
  '-s',
  '--server',
  '--attach',
  '--port',
  '--agent',
];
const CONTROLLED_BOOLEAN_FLAGS = ['--continue', '-c', '--fork', '--standalone'];

const sanitizeBindingArgs = (source: string[]) => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    const flag = CONTROLLED_VALUE_FLAGS.find(
      (value) => arg === value || arg.startsWith(`${value}=`),
    );
    if (flag) {
      if (arg === flag) index += 1;
      continue;
    }
    if (CONTROLLED_BOOLEAN_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))
      continue;
    args.push(arg);
  }
  return args;
};

export const opencodeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const inputPlan = await helpers.buildAgentInput('opencode', promptInput);

    return {
      args: [
        ...OPENCODE_BASE_ARGS,
        ...(resumeSessionId ? ['--session', resumeSessionId] : []),
        ...args,
        ...inputPlan.args,
      ],
      stdinPayload: inputPlan.stdin,
    };
  },
  prepareServerDefaultBinding({ args, endpoint, env, model, modelDescriptor, profileDir }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    const selectedModel = `${PROVIDER}/${requestModel}`;
    const config = {
      enabled_providers: [PROVIDER],
      model: selectedModel,
      small_model: selectedModel,
      provider: {
        [PROVIDER]: {
          name: 'LobeHub Server Default',
          npm: '@ai-sdk/openai',
          options: {
            apiKey: `{env:${TOKEN_ENV}}`,
            baseURL: `${endpoint}/api/v1/openai/v1`,
          },
          models: {
            [requestModel]: {
              name: modelDescriptor?.displayName || model,
              limit: {
                context:
                  modelDescriptor?.contextWindowTokens && modelDescriptor.contextWindowTokens > 0
                    ? modelDescriptor.contextWindowTokens
                    : 128_000,
                output:
                  modelDescriptor?.maxOutput && modelDescriptor.maxOutput > 0
                    ? modelDescriptor.maxOutput
                    : 16_384,
              },
              modalities: {
                input: modelDescriptor?.abilities.vision ? ['text', 'image'] : ['text'],
                output: ['text'],
              },
              reasoning: modelDescriptor?.abilities.reasoning === true,
              tool_call: true,
            },
          },
        },
      },
    };
    const bindingEnv = { ...env };
    delete bindingEnv[TOKEN_ENV];
    return {
      // A shared background server cannot pick up a fresh per-operation token.
      args: ['--standalone', '--model', selectedModel, ...sanitizeBindingArgs(args)],
      env: {
        ...bindingEnv,
        OPENCODE_CONFIG: path.join(profileDir, 'opencode.json'),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        OPENCODE_CONFIG_DIR: profileDir,
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
        XDG_CONFIG_HOME: path.join(profileDir, 'config'),
        XDG_DATA_HOME: path.join(profileDir, 'data'),
        XDG_STATE_HOME: path.join(profileDir, 'state'),
      },
      operationTokenEnvKey: TOKEN_ENV,
      profileFiles: [{ content: '{}\n', path: 'opencode.json' }],
    };
  },
};
