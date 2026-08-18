import type { AiProviderSDKType } from '@lobechat/types';

export const CLAUDE_CODE_API_LOCAL_ONLY_ERROR =
  'Claude Code API mode is only supported for Desktop local execution.';

export interface BuildClaudeCodeDirectEnvInput {
  /** Decrypted provider credentials. This function is for trusted local execution only. */
  keyVaults?: Record<string, unknown>;
  model: string;
  sdkType?: AiProviderSDKType | string;
  smallFastModel?: string | null;
}

export interface BuildClaudeCodeDirectEnvResult {
  env: Record<string, string>;
  error?: string;
}

const DIRECT_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

const pickNonEmptyString = (value: unknown): string | undefined => {
  const stringValue = typeof value === 'string' ? value.trim() : undefined;
  return stringValue || undefined;
};

/** Remove user-configured auth/model routing before applying a host-managed direct binding. */
export const sanitizeClaudeCodeDirectEnv = (
  source: Record<string, string> | undefined,
): Record<string, string> => {
  const env = { ...source };
  for (const key of DIRECT_AUTH_ENV_KEYS) delete env[key];
  return env;
};

/** Remove every persisted model override before applying the API-bound model. */
export const sanitizeClaudeCodeDirectArgs = (source: string[] | undefined): string[] => {
  const sourceArgs = source ?? [];
  const args: string[] = [];

  for (let index = 0; index < sourceArgs.length; index += 1) {
    const arg = sourceArgs[index];
    if (arg === '--model') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--model=')) continue;
    args.push(arg);
  }

  return args;
};

/**
 * Resolve a LobeHub provider into Claude Code environment variables.
 *
 * This accepts decrypted credentials and must only run inside the trusted Desktop-local
 * boundary. Remote targets must use an operation-scoped gateway instead.
 */
export const buildClaudeCodeDirectEnv = (
  input: BuildClaudeCodeDirectEnvInput,
): BuildClaudeCodeDirectEnvResult => {
  const model = pickNonEmptyString(input.model);
  if (!model) return { env: {}, error: 'Model id is required for Claude Code API mode.' };

  if (input.sdkType !== 'anthropic') {
    return {
      env: {},
      error: `Claude Code API mode does not support sdkType="${input.sdkType ?? 'unknown'}".`,
    };
  }

  const apiKey = pickNonEmptyString(input.keyVaults?.apiKey);
  if (!apiKey) {
    return { env: {}, error: 'Provider apiKey is missing. Configure it in provider settings.' };
  }

  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: pickNonEmptyString(input.smallFastModel) ?? model,
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    CLAUDE_CODE_USE_BEDROCK: '0',
    CLAUDE_CODE_USE_MANTLE: '0',
    CLAUDE_CODE_USE_VERTEX: '0',
  };

  const baseURL = pickNonEmptyString(input.keyVaults?.baseURL);
  if (baseURL) env.ANTHROPIC_BASE_URL = baseURL;

  return { env };
};
