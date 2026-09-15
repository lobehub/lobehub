import { createHash } from 'node:crypto';

import type { HeterogeneousProviderBindingProtocol } from '@lobechat/heterogeneous-agents';
import { buildGrokAcpArgs } from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import type { HeterogeneousAgentDriver } from '../types';

const HOST_API_KEY_ENV = 'LOBEHUB_GROK_API_KEY';
const HOST_MODEL_ALIAS_PREFIX = 'lobehub-provider';

const GROK_PROVIDER_BINDING_VALUE_FLAGS = [
  '-m',
  '--agent',
  '--agent-profile',
  '--model',
  '--resume',
  '--session-id',
] as const;

const GROK_PROVIDER_BINDING_BOOLEAN_FLAGS = ['-c', '--continue'] as const;

const GROK_PROVIDER_BINDING_BLOCKED_ENV = [
  'GROK_AGENT',
  'GROK_CONFIG',
  'GROK_CONFIG_PATH',
  'GROK_DEFAULT_MODEL',
] as const;

const tomlString = (value: string): string => JSON.stringify(value);

const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

const stripOperationPath = (endpoint: string, operationPath: string): string => {
  const normalized = stripTrailingSlashes(endpoint);
  return normalized.endsWith(operationPath)
    ? stripTrailingSlashes(normalized.slice(0, -operationPath.length))
    : normalized;
};

const normalizeGrokBaseURL = (
  endpoint: string,
  protocol: HeterogeneousProviderBindingProtocol,
): string => {
  switch (protocol) {
    case 'anthropic-messages': {
      const baseURL = stripOperationPath(endpoint, '/messages');
      return baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`;
    }
    case 'openai-chat-completions': {
      return stripOperationPath(endpoint, '/chat/completions');
    }
    case 'openai-responses': {
      return stripOperationPath(endpoint, '/responses');
    }
    default: {
      throw new Error(`Grok Build cannot use ${protocol}.`);
    }
  }
};

const getGrokApiBackend = (
  protocol: HeterogeneousProviderBindingProtocol,
): 'chat_completions' | 'messages' | 'responses' => {
  switch (protocol) {
    case 'anthropic-messages': {
      return 'messages';
    }
    case 'openai-chat-completions': {
      return 'chat_completions';
    }
    case 'openai-responses': {
      return 'responses';
    }
    default: {
      throw new Error(`Grok Build cannot use ${protocol}.`);
    }
  }
};

const buildModelAlias = (identity: string): string =>
  `${HOST_MODEL_ALIAS_PREFIX}-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;

export const sanitizeGrokProviderBindingArgs = (source: string[]): string[] => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    if (
      GROK_PROVIDER_BINDING_VALUE_FLAGS.includes(
        arg as (typeof GROK_PROVIDER_BINDING_VALUE_FLAGS)[number],
      )
    ) {
      index += 1;
      continue;
    }
    if (
      GROK_PROVIDER_BINDING_BOOLEAN_FLAGS.includes(
        arg as (typeof GROK_PROVIDER_BINDING_BOOLEAN_FLAGS)[number],
      ) ||
      GROK_PROVIDER_BINDING_VALUE_FLAGS.some((flag) => arg.startsWith(`${flag}=`))
    ) {
      continue;
    }
    args.push(arg);
  }
  return args;
};

const sanitizeGrokProviderBindingEnv = (
  source: Record<string, string> | undefined,
): Record<string, string> => {
  const env = { ...source };
  delete env.GROK_HOME;
  delete env[HOST_API_KEY_ENV];
  delete env.GROK_CODE_XAI_API_KEY;
  delete env.XAI_API_KEY;
  // Empty values deliberately shadow variables inherited later by the spawn
  // boundary, keeping model/profile selection inside the managed GROK_HOME.
  for (const key of GROK_PROVIDER_BINDING_BLOCKED_ENV) env[key] = '';
  return env;
};

/**
 * Grok Build uses the bidirectional ACP stdio transport in the controller.
 * Its spawn plan is only a diagnostic representation and is never passed to
 * the generic one-shot path; provider binding preparation is still owned here.
 */
export const grokBuildDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return {
      args: buildGrokAcpArgs(args),
    };
  },
  prepareProviderBinding({ args, env, profileDir, resolution }) {
    if (!resolution.endpoint) {
      throw new Error('Grok Build provider binding requires an API endpoint.');
    }

    const apiKey = resolution.runtimeConfig.keyVaults.apiKey?.trim();
    if (!apiKey) throw new Error('Grok Build provider binding requires an API key.');

    const apiBackend = getGrokApiBackend(resolution.protocol);
    const baseURL = normalizeGrokBaseURL(resolution.endpoint, resolution.protocol);
    const alias = buildModelAlias(
      [resolution.providerId, resolution.protocol, baseURL, resolution.apiConfig.model].join('\0'),
    );
    const isMessages = resolution.protocol === 'anthropic-messages';
    const config = [
      `[model.${alias}]`,
      `name = ${tomlString('LobeHub Provider')}`,
      `model = ${tomlString(resolution.apiConfig.model)}`,
      `base_url = ${tomlString(baseURL)}`,
      `env_key = ${tomlString(HOST_API_KEY_ENV)}`,
      `api_backend = ${tomlString(apiBackend)}`,
      `auth_scheme = ${tomlString(isMessages ? 'x_api_key' : 'bearer')}`,
      ...(isMessages ? ['extra_headers = { "anthropic-version" = "2023-06-01" }'] : []),
      '',
      '[models]',
      `default = ${tomlString(alias)}`,
      '',
    ].join('\n');

    return {
      args: [...sanitizeGrokProviderBindingArgs(args), '--model', alias],
      env: {
        ...sanitizeGrokProviderBindingEnv(env),
        GROK_HOME: profileDir,
        [HOST_API_KEY_ENV]: apiKey,
      },
      profileFiles: [{ content: config, path: 'config.toml' }],
    };
  },
  prepareServerDefaultBinding({ args, endpoint, env, model, profileDir }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    const alias = buildModelAlias(['server-default', endpoint, model].join('\0'));
    const config = [
      `[model.${alias}]`,
      `name = ${tomlString('LobeHub Server Default')}`,
      `model = ${tomlString(requestModel)}`,
      `base_url = ${tomlString(`${stripTrailingSlashes(endpoint)}/api/v1/openai/v1`)}`,
      `env_key = ${tomlString(HOST_API_KEY_ENV)}`,
      'api_backend = "responses"',
      'auth_scheme = "bearer"',
      '',
      '[models]',
      `default = ${tomlString(alias)}`,
      '',
    ].join('\n');

    return {
      args: [...sanitizeGrokProviderBindingArgs(args), '--model', alias],
      env: {
        ...sanitizeGrokProviderBindingEnv(env),
        GROK_HOME: profileDir,
      },
      operationTokenEnvKey: HOST_API_KEY_ENV,
      profileFiles: [{ content: config, path: 'config.toml' }],
    };
  },
};
