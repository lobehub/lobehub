import type { AiProviderSDKType } from '@lobechat/types';

export const HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR =
  'Heterogeneous agent provider binding is only supported for Desktop local execution.';

/**
 * Desktop main resolves the binding's providerId in the PERSONAL scope only
 * (deliberately no workspace header — see `providerBindingPort`). A workspace
 * agent's binding would have been configured against workspace-scoped
 * providers, so running it locally could silently resolve a personal provider
 * that shares the same id (builtin ids like `anthropic` collide across scopes)
 * and bill the wrong account. Blocked before IPC for every entry point.
 */
export const HETEROGENEOUS_PROVIDER_BINDING_PERSONAL_ONLY_ERROR =
  'Heterogeneous agent provider binding is not supported for workspace agents.';

/** @deprecated Use HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR. */
export const CLAUDE_CODE_API_LOCAL_ONLY_ERROR = HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR;

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

/**
 * Claude Code appends `/v1/messages` to `ANTHROPIC_BASE_URL`.
 * LobeHub provider settings often store the SDK-style host (`…/v1` or `…/v1/messages`).
 * Strip with linear string ops; quantified-slash regexes are ReDoS on user URLs.
 */
const ANTHROPIC_SDK_BASE_URL_SUFFIXES = ['/v1/messages', '/v1'] as const;
const FIRST_PARTY_ANTHROPIC_HOSTS = new Set(['api.anthropic.com']);

const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

const normalizeClaudeCodeBaseURL = (baseURL: string): string | undefined => {
  let normalized = stripTrailingSlashes(baseURL);
  for (const suffix of ANTHROPIC_SDK_BASE_URL_SUFFIXES) {
    if (!normalized.endsWith(suffix)) continue;
    normalized = stripTrailingSlashes(normalized.slice(0, -suffix.length));
    break;
  }
  return normalized || undefined;
};

const isFirstPartyAnthropicBaseURL = (baseURL?: string): boolean => {
  if (!baseURL) return true;
  try {
    return FIRST_PARTY_ANTHROPIC_HOSTS.has(new URL(baseURL).hostname);
  } catch {
    return false;
  }
};

/** Remove user-configured auth/model routing before applying a host-managed direct binding. */
export const sanitizeClaudeCodeDirectEnv = (
  source: Record<string, string> | undefined,
): Record<string, string> => {
  const env = { ...source };
  for (const key of DIRECT_AUTH_ENV_KEYS) delete env[key];
  return env;
};

/** Remove persisted model/session overrides before applying a host-authoritative binding. */
export const sanitizeClaudeCodeDirectArgs = (source: string[] | undefined): string[] => {
  const sourceArgs = source ?? [];
  const args: string[] = [];

  for (let index = 0; index < sourceArgs.length; index += 1) {
    const arg = sourceArgs[index];
    if (arg === '--model' || arg === '--resume' || arg === '--session-id') {
      index += 1;
      continue;
    }
    if (
      arg === '--continue' ||
      arg === '-c' ||
      arg.startsWith('--model=') ||
      arg.startsWith('--resume=') ||
      arg.startsWith('--session-id=')
    ) {
      continue;
    }
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

  const baseURL = pickNonEmptyString(input.keyVaults?.baseURL);
  const normalizedBaseURL = baseURL ? normalizeClaudeCodeBaseURL(baseURL) : undefined;
  const useFirstPartyApiKey = isFirstPartyAnthropicBaseURL(normalizedBaseURL);

  const env: Record<string, string> = {
    ANTHROPIC_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: pickNonEmptyString(input.smallFastModel) ?? model,
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    CLAUDE_CODE_USE_BEDROCK: '0',
    CLAUDE_CODE_USE_MANTLE: '0',
    CLAUDE_CODE_USE_VERTEX: '0',
    ...(useFirstPartyApiKey ? { ANTHROPIC_API_KEY: apiKey } : { ANTHROPIC_AUTH_TOKEN: apiKey }),
  };

  if (normalizedBaseURL) env.ANTHROPIC_BASE_URL = normalizedBaseURL;

  return { env };
};
