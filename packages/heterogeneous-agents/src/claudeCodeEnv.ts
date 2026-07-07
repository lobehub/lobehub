import type { AiProviderSDKType } from '@lobechat/types';

export interface BuildClaudeCodeApiEnvInput {
  /** Decrypted keyVaults for the provider */
  keyVaults?: Record<string, unknown>;
  /** Primary model id → ANTHROPIC_MODEL (or equivalent) */
  model: string;
  /** Provider sdkType (e.g. 'anthropic', 'bedrock') */
  sdkType?: AiProviderSDKType | string;
  /** Optional fast-path model → ANTHROPIC_SMALL_FAST_MODEL */
  smallFastModel?: string;
}

export interface BuildClaudeCodeApiEnvResult {
  env: Record<string, string>;
  /** Non-null when inputs are insufficient (missing key / unsupported sdk). */
  error?: string;
}

const pickNonEmptyString = (value: unknown): string | undefined => {
  const stringValue = typeof value === 'string' ? value.trim() : undefined;
  return stringValue || undefined;
};

const buildAnthropicEnv = (input: BuildClaudeCodeApiEnvInput): BuildClaudeCodeApiEnvResult => {
  const apiKey = pickNonEmptyString(input.keyVaults?.apiKey);
  if (!apiKey) {
    return { env: {}, error: 'Provider apiKey is missing. Configure it in provider settings.' };
  }

  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_MODEL: input.model,
  };

  const baseURL = pickNonEmptyString(input.keyVaults?.baseURL);
  if (baseURL) env.ANTHROPIC_BASE_URL = baseURL;

  const smallFastModel = pickNonEmptyString(input.smallFastModel);
  if (smallFastModel) env.ANTHROPIC_SMALL_FAST_MODEL = smallFastModel;

  return { env };
};

/**
 * Translate a LobeHub AI-provider binding into env vars Claude Code CLI understands.
 *
 * CC reads credentials from env vars (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL
 * / ANTHROPIC_SMALL_FAST_MODEL) that take precedence over ~/.claude/credentials.json,
 * so injecting them at spawn time is enough to override the subscription session without
 * touching the user's stored login.
 *
 * Phase 1 supports sdkType === 'anthropic' (covers Anthropic official, Moonshot, Kimi
 * CodingPlan, and any custom provider with an Anthropic-compatible `/v1/messages` endpoint).
 */
export const buildClaudeCodeApiEnv = (
  input: BuildClaudeCodeApiEnvInput,
): BuildClaudeCodeApiEnvResult => {
  if (!input.model) {
    return { env: {}, error: 'Model id is required for API mode.' };
  }

  switch (input.sdkType) {
    case 'anthropic': {
      return buildAnthropicEnv(input);
    }
    default: {
      return {
        env: {},
        error: `Claude Code API mode does not support sdkType="${input.sdkType ?? 'unknown'}" yet.`,
      };
    }
  }
};
