import type { LocalHeterogeneousAgentType } from '../config';

export type ServerDefaultHeterogeneousIngress = 'anthropic-messages' | 'openai-responses';

export type ServerDefaultHeterogeneousModelPolicy = 'codex' | 'tool-capable';

export type ServerDefaultHeterogeneousTokenHeader = 'bearer' | 'x-api-key';

interface ServerDefaultHeterogeneousAgentConfig {
  ingress: ServerDefaultHeterogeneousIngress;
  modelPolicy: ServerDefaultHeterogeneousModelPolicy;
  tokenHeader: ServerDefaultHeterogeneousTokenHeader;
}

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
    ingress: 'anthropic-messages',
    modelPolicy: 'tool-capable',
    tokenHeader: 'x-api-key',
  },
  'pi': {
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
