import {
  CODEX_DEFAULT_EXECUTION_ARGS,
  CODEX_EXECUTION_MODE_FLAGS,
  CODEX_REQUIRED_ARGS,
} from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const hasAnyFlag = (args: string[], flags: readonly string[]) =>
  args.some((arg) => flags.includes(arg as (typeof flags)[number]));

const HOST_PROVIDER_ID = 'lobehub';
const HOST_API_KEY_ENV = 'LOBEHUB_CODEX_API_KEY';

const isConflictingConfigOverride = (value: string): boolean => {
  const key = value.split('=', 1)[0]?.trim();
  return key === 'model' || key === 'model_provider' || key.startsWith('model_providers.');
};

export const sanitizeCodexProviderBindingArgs = (source: string[]): string[] => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    if (arg === '--model' || arg === '-m') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--model=') || arg.startsWith('-m=')) continue;
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

const sanitizeCodexProviderBindingEnv = (source: Record<string, string> | undefined) => {
  const env = { ...source };
  delete env.CODEX_HOME;
  delete env.OPENAI_API_KEY;
  delete env[HOST_API_KEY_ENV];
  return env;
};

const tomlString = (value: string): string => JSON.stringify(value);

const buildCodexOptionArgs = async ({
  args,
  helpers,
  promptInput,
}: Pick<HeterogeneousAgentBuildPlanParams, 'args' | 'helpers' | 'promptInput'>) => {
  const inputPlan = await helpers.buildAgentInput('codex', promptInput);
  const executionModeArgs = hasAnyFlag(args, CODEX_EXECUTION_MODE_FLAGS)
    ? []
    : [...CODEX_DEFAULT_EXECUTION_ARGS];

  return {
    args: [...CODEX_REQUIRED_ARGS, ...executionModeArgs, ...args, ...inputPlan.args],
    stdinPayload: inputPlan.stdin,
  };
};

export const codexDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const { args: optionArgs, stdinPayload } = await buildCodexOptionArgs({
      args,
      helpers,
      promptInput,
    });

    return {
      args: resumeSessionId
        ? ['exec', 'resume', ...optionArgs, resumeSessionId, '-']
        : ['exec', ...optionArgs],
      stdinPayload,
    };
  },
  prepareProviderBinding({ args, env, profileDir, resolution }) {
    if (resolution.protocol !== 'openai-responses' || !resolution.endpoint) {
      throw new Error('Codex provider binding requires a Responses API endpoint.');
    }

    const apiKey = resolution.runtimeConfig.keyVaults.apiKey?.trim();
    if (!apiKey) throw new Error('Codex provider binding requires an API key.');

    const config = [
      `model_provider = ${tomlString(HOST_PROVIDER_ID)}`,
      '',
      `[model_providers.${HOST_PROVIDER_ID}]`,
      `name = ${tomlString('LobeHub Provider')}`,
      `base_url = ${tomlString(resolution.endpoint)}`,
      `env_key = ${tomlString(HOST_API_KEY_ENV)}`,
      'wire_api = "responses"',
      'requires_openai_auth = false',
      '',
    ].join('\n');

    return {
      args: [...sanitizeCodexProviderBindingArgs(args), '--model', resolution.apiConfig.model],
      env: {
        ...sanitizeCodexProviderBindingEnv(env),
        CODEX_HOME: profileDir,
        [HOST_API_KEY_ENV]: apiKey,
      },
      profileFiles: [{ content: config, path: 'config.toml' }],
    };
  },
};
