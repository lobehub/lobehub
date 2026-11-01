import { KIMI_CODE_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import { startProviderBindingProxy } from '../providerBindingProxy';
import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const KIMI_CODE_PROVIDER_BINDING_ENV_KEYS = [
  'KIMI_CODE_HOME',
  'KIMI_MODEL_API_KEY',
  'KIMI_MODEL_BASE_URL',
  'KIMI_MODEL_NAME',
  'KIMI_MODEL_PROVIDER_TYPE',
] as const;

const sanitizeKimiCodeProviderBindingArgs = (source: string[]): string[] => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    if (['--continue', '-c', '-C'].includes(arg)) continue;

    if (arg === '--model' || arg === '-m') {
      index += 1;
      continue;
    }
    if (
      arg.startsWith('--model=') ||
      (arg.startsWith('-m') && !arg.startsWith('--') && arg.length > 2)
    )
      continue;

    if (['--resume', '--session', '-r', '-S'].includes(arg)) {
      if (source[index + 1] && !source[index + 1].startsWith('-')) index += 1;
      continue;
    }
    if (
      arg.startsWith('--resume=') ||
      arg.startsWith('--session=') ||
      ((arg.startsWith('-r') || arg.startsWith('-S')) && !arg.startsWith('--') && arg.length > 2)
    )
      continue;
    args.push(arg);
  }
  return args;
};

const sanitizeKimiCodeProviderBindingEnv = (source: Record<string, string> | undefined) => {
  const env = { ...source };
  for (const key of KIMI_CODE_PROVIDER_BINDING_ENV_KEYS) delete env[key];
  return env;
};

export const kimiCodeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const inputPlan = await helpers.buildAgentInput('kimi-code', promptInput);
    return {
      args: [
        ...KIMI_CODE_BASE_ARGS,
        ...(resumeSessionId ? ['--session', resumeSessionId] : []),
        ...args,
        ...inputPlan.args,
      ],
      stdinPayload: inputPlan.stdin,
    };
  },
  async prepareProviderBinding({ args, env, profileDir, resolution }) {
    const protocol = resolution.protocol;
    if (protocol !== 'anthropic-messages' && protocol !== 'openai-chat-completions') {
      throw new Error(`Kimi Code cannot use ${protocol}.`);
    }
    const providerType = protocol === 'anthropic-messages' ? 'anthropic' : 'openai';

    const apiKey = resolution.runtimeConfig.keyVaults.apiKey?.trim();
    if (!apiKey) throw new Error('Kimi Code provider binding requires an API key.');
    const proxy = await startProviderBindingProxy({
      apiKey,
      endpoint: resolution.endpoint,
      protocol,
    });

    return {
      args: sanitizeKimiCodeProviderBindingArgs(args),
      cleanup: proxy.close,
      cleanupSync: proxy.closeSync,
      env: {
        ...sanitizeKimiCodeProviderBindingEnv(env),
        KIMI_CODE_HOME: profileDir,
        KIMI_MODEL_API_KEY: proxy.clientApiKey,
        KIMI_MODEL_BASE_URL: proxy.endpoint,
        KIMI_MODEL_NAME: resolution.apiConfig.model,
        KIMI_MODEL_PROVIDER_TYPE: providerType,
      },
    };
  },
  prepareServerDefaultBinding({ args, endpoint, env, model, profileDir }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    return {
      args: sanitizeKimiCodeProviderBindingArgs(args),
      env: {
        ...sanitizeKimiCodeProviderBindingEnv(env),
        KIMI_CODE_HOME: profileDir,
        KIMI_MODEL_BASE_URL: `${endpoint}/api/v1/anthropic`,
        KIMI_MODEL_NAME: requestModel,
        KIMI_MODEL_PROVIDER_TYPE: 'anthropic',
      },
      operationTokenEnvKey: 'KIMI_MODEL_API_KEY',
    };
  },
};
