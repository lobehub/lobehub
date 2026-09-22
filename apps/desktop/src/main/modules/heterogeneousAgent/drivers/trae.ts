import { buildTraeAcpArgs } from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import type { HeterogeneousAgentDriver } from '../types';

const HOST_API_KEY_ENV = 'LOBEHUB_TRAE_API_KEY';
const HOST_PROVIDER_ID = 'lobehub';

const isConflictingConfigOverride = (value: string): boolean => {
  const key = value.split('=', 1)[0]?.trim();
  return key === 'model' || key === 'model_provider' || key.startsWith('model_providers.');
};

export const sanitizeTraeProviderBindingArgs = (source: string[]): string[] => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    if (arg === '--model' || arg === '-m' || arg === '--profile' || arg === '-p') {
      index += 1;
      continue;
    }
    if (
      arg.startsWith('--model=') ||
      arg.startsWith('-m=') ||
      arg.startsWith('--profile=') ||
      arg.startsWith('-p=')
    ) {
      continue;
    }
    if (arg === '--config' || arg === '-c') {
      const value = source[index + 1];
      if (value && isConflictingConfigOverride(value)) {
        index += 1;
        continue;
      }
    }
    if (
      (arg.startsWith('--config=') || arg.startsWith('-c=')) &&
      isConflictingConfigOverride(arg.slice(arg.indexOf('=') + 1))
    ) {
      continue;
    }
    args.push(arg);
  }
  return args;
};

const sanitizeTraeProviderBindingEnv = (source: Record<string, string> | undefined) => {
  const env = { ...source };
  delete env.OPENAI_API_KEY;
  delete env[HOST_API_KEY_ENV];
  return env;
};

const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

const tomlString = (value: string): string => JSON.stringify(value);

const buildTraeProviderArgs = (params: { baseURL: string; model: string }): string[] =>
  [
    ['model', tomlString(params.model)],
    ['model_provider', tomlString(HOST_PROVIDER_ID)],
    [`model_providers.${HOST_PROVIDER_ID}.name`, tomlString('LobeHub Provider')],
    [`model_providers.${HOST_PROVIDER_ID}.base_url`, tomlString(params.baseURL)],
    [`model_providers.${HOST_PROVIDER_ID}.env_key`, tomlString(HOST_API_KEY_ENV)],
    [`model_providers.${HOST_PROVIDER_ID}.wire_api`, tomlString('responses')],
    [`model_providers.${HOST_PROVIDER_ID}.requires_openai_auth`, 'false'],
  ].flatMap(([key, value]) => ['-c', `${key}=${value}`]);

/**
 * TRAE uses a bidirectional ACP session rather than the ordinary one-way JSONL
 * process path. This driver keeps type registration consistent; the desktop
 * controller hands the resulting arguments to `TraeAcpSession` directly.
 */
export const traeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return { args: buildTraeAcpArgs(args) };
  },
  prepareProviderBinding({ args, env, resolution }) {
    if (resolution.protocol !== 'openai-responses' || !resolution.endpoint) {
      throw new Error('TRAE provider binding requires a Responses API endpoint.');
    }

    const apiKey = resolution.runtimeConfig.keyVaults.apiKey?.trim();
    if (!apiKey) throw new Error('TRAE provider binding requires an API key.');

    return {
      args: [
        ...sanitizeTraeProviderBindingArgs(args),
        ...buildTraeProviderArgs({
          baseURL: resolution.endpoint,
          model: resolution.apiConfig.model,
        }),
      ],
      env: {
        ...sanitizeTraeProviderBindingEnv(env),
        [HOST_API_KEY_ENV]: apiKey,
      },
    };
  },
  prepareServerDefaultBinding({ args, endpoint, env, model }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    return {
      args: [
        ...sanitizeTraeProviderBindingArgs(args),
        ...buildTraeProviderArgs({
          baseURL: `${stripTrailingSlashes(endpoint)}/api/v1/openai/v1`,
          model: requestModel,
        }),
      ],
      env: sanitizeTraeProviderBindingEnv(env),
      operationTokenEnvKey: HOST_API_KEY_ENV,
    };
  },
};
