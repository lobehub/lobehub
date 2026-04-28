import type { HeterogeneousProviderConfig } from '@lobechat/types';

export type HeterogeneousAgentMenuLabelKey = 'newClaudeCodeAgent' | 'newCodexAgent';

export interface HeterogeneousAgentConfig {
  command: string;
  iconId: string;
  menuKey: string;
  menuLabelKey: HeterogeneousAgentMenuLabelKey;
  title: string;
  type: HeterogeneousProviderConfig['type'];
}

export const HETEROGENEOUS_AGENT_CONFIGS = [
  {
    command: 'claude',
    iconId: 'ClaudeCode',
    menuKey: 'newClaudeCodeAgent',
    menuLabelKey: 'newClaudeCodeAgent',
    title: 'Claude Code',
    type: 'claude-code',
  },
  {
    command: 'codex',
    iconId: 'Codex',
    menuKey: 'newCodexAgent',
    menuLabelKey: 'newCodexAgent',
    title: 'Codex',
    type: 'codex',
  },
] as const satisfies readonly HeterogeneousAgentConfig[];

export const getHeterogeneousAgentConfig = (type: HeterogeneousProviderConfig['type']) =>
  HETEROGENEOUS_AGENT_CONFIGS.find((config) => config.type === type);
