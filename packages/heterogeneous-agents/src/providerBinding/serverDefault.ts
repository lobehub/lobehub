import type { LocalHeterogeneousAgentType } from '../config';

export type ServerDefaultHeterogeneousIngress = 'anthropic-messages' | 'openai-responses';

export type ServerDefaultHeterogeneousCompatibilityProfile = 'kimi-code/anthropic-v1';

export type ServerDefaultHeterogeneousModelPolicy = 'codex' | 'profile-attested' | 'tool-capable';

export type ServerDefaultHeterogeneousTokenHeader = 'bearer' | 'x-api-key';

interface ServerDefaultHeterogeneousAgentConfigBase {
  ingress: ServerDefaultHeterogeneousIngress;
  tokenHeader: ServerDefaultHeterogeneousTokenHeader;
}

type ServerDefaultHeterogeneousAgentConfig = ServerDefaultHeterogeneousAgentConfigBase &
  (
    | {
        compatibilityProfile: ServerDefaultHeterogeneousCompatibilityProfile;
        modelPolicy: 'profile-attested';
      }
    | {
        compatibilityProfile?: never;
        modelPolicy: Exclude<ServerDefaultHeterogeneousModelPolicy, 'profile-attested'>;
      }
  );

/**
 * Bootstrap attestations from the real server-default compatibility matrix.
 * Deployment model cards may replace these defaults with their own explicit
 * `serverDefaultHeterogeneousProfiles` metadata. New models therefore remain
 * unavailable until either the deployment or this certified baseline opts in.
 */
export const SERVER_DEFAULT_HETEROGENEOUS_PROFILE_DEFAULT_MODELS = {
  'kimi-code/anthropic-v1': [
    'deepseek-v4-flash-vision-exp',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'claude-fable-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
    'claude-haiku-4-5-20251001',
    'grok-4.6',
    'grok-4.5',
    'glm-5.3-flash',
    'glm-5.3',
    'glm-5.2',
    'lobehub-glm-5.2-fast',
    'kimi-k3',
    'lobehub-kimi-k3-fast',
    'kimi-k2.7-code',
    'qwen3.8-max',
    'qwen3.8-max-preview',
    'MiniMax-M3',
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'lobehub-onboarding-v1',
  ],
} as const satisfies Record<ServerDefaultHeterogeneousCompatibilityProfile, readonly string[]>;

export const isServerDefaultHeterogeneousProfileModel = (
  profile: ServerDefaultHeterogeneousCompatibilityProfile,
  model: string,
) =>
  (SERVER_DEFAULT_HETEROGENEOUS_PROFILE_DEFAULT_MODELS[profile] as readonly string[]).includes(
    model,
  );

export const SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG = {
  'claude-code': {
    ingress: 'anthropic-messages',
    modelPolicy: 'tool-capable',
    tokenHeader: 'bearer',
  },
  'codex': {
    ingress: 'openai-responses',
    modelPolicy: 'codex',
    tokenHeader: 'bearer',
  },
  'grok-build': {
    ingress: 'openai-responses',
    modelPolicy: 'tool-capable',
    tokenHeader: 'bearer',
  },
  'kimi-code': {
    compatibilityProfile: 'kimi-code/anthropic-v1',
    ingress: 'anthropic-messages',
    modelPolicy: 'profile-attested',
    tokenHeader: 'x-api-key',
  },
  'pi': {
    ingress: 'openai-responses',
    modelPolicy: 'tool-capable',
    tokenHeader: 'bearer',
  },
  'trae': {
    ingress: 'openai-responses',
    modelPolicy: 'tool-capable',
    tokenHeader: 'bearer',
  },
} as const satisfies Partial<
  Record<LocalHeterogeneousAgentType, ServerDefaultHeterogeneousAgentConfig>
>;

export type ServerDefaultHeterogeneousAgentType =
  keyof typeof SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG;

export const SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES = Object.keys(
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG,
) as ServerDefaultHeterogeneousAgentType[];

export const getServerDefaultHeterogeneousAgentConfig = (
  agentType: string | undefined,
): ServerDefaultHeterogeneousAgentConfig | undefined => {
  if (!agentType || !Object.hasOwn(SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG, agentType)) return;
  return SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG[
    agentType as ServerDefaultHeterogeneousAgentType
  ];
};

export const isServerDefaultHeterogeneousAgentType = (
  agentType: string | undefined,
): agentType is ServerDefaultHeterogeneousAgentType =>
  !!getServerDefaultHeterogeneousAgentConfig(agentType);
