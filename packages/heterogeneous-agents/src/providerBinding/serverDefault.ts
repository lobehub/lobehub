import type { LocalHeterogeneousAgentType } from '../config';

export type ServerDefaultHeterogeneousIngress = 'anthropic-messages' | 'openai-responses';

export type ServerDefaultHeterogeneousTokenHeader = 'bearer' | 'x-api-key';

interface ServerDefaultHeterogeneousAgentConfig {
  ingress: ServerDefaultHeterogeneousIngress;
  tokenHeader: ServerDefaultHeterogeneousTokenHeader;
}

export const SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG = {
  'droid': {
    ingress: 'anthropic-messages',
    tokenHeader: 'x-api-key',
  },
  'claude-code': {
    ingress: 'anthropic-messages',
    tokenHeader: 'bearer',
  },
  'codex': {
    ingress: 'openai-responses',
    tokenHeader: 'bearer',
  },
  'grok-build': {
    ingress: 'openai-responses',
    tokenHeader: 'bearer',
  },
  'kimi-code': {
    ingress: 'anthropic-messages',
    tokenHeader: 'x-api-key',
  },
  'pi': {
    ingress: 'openai-responses',
    tokenHeader: 'bearer',
  },
  'opencode': {
    ingress: 'openai-responses',
    tokenHeader: 'bearer',
  },
  'trae': {
    ingress: 'openai-responses',
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
