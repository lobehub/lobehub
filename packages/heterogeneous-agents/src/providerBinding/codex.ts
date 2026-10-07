import type { PrepareProviderBindingContext, ProviderBindingPlan } from './hostTypes';

const HOST_PROVIDER_ID = 'lobehub';
const HOST_API_KEY_ENV = 'LOBEHUB_CODEX_API_KEY';
const SERVER_TOKEN_ENV = 'LOBEHUB_HETERO_TOKEN';

const isConflictingConfigOverride = (value: string): boolean => {
  const key = value.split('=', 1)[0]?.trim();
  return (
    key === 'model' ||
    key === 'model_catalog_json' ||
    key === 'model_provider' ||
    key === 'model_providers' ||
    key.startsWith('model_providers.')
  );
};

export const sanitizeCodexProviderBindingArgs = (source: string[]): string[] => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    if (arg === '--model' || arg === '-m') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--model=') || (arg.startsWith('-m') && !arg.startsWith('--'))) continue;
    if (
      arg.startsWith('-c') &&
      !arg.startsWith('--') &&
      arg.length > 2 &&
      isConflictingConfigOverride(arg.slice(2).replace(/^=/, ''))
    )
      continue;
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

export const sanitizeCodexProviderBindingEnv = (source: Record<string, string> | undefined) => {
  const env = { ...source };
  delete env.CODEX_HOME;
  delete env.OPENAI_API_KEY;
  delete env[HOST_API_KEY_ENV];
  delete env[SERVER_TOKEN_ENV];
  return env;
};

const tomlString = (value: string): string => JSON.stringify(value);

/**
 * Prepare Codex's Responses binding without changing its native user profile.
 *
 * Use when:
 * - Desktop or connect has resolved a personal provider.
 * Expects:
 * - A validated provider resolution and a private managed profile directory.
 * Returns:
 * - Secret-free argv/config files and a child-only API key environment.
 *
 * Call stack:
 * prepareHostedProviderBinding (./nodeHost)
 *   -> {@link prepareCodexProviderBinding}
 */
export function prepareCodexProviderBinding({
  args,
  env,
  profileDir,
  resolution,
}: PrepareProviderBindingContext): ProviderBindingPlan {
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
}
