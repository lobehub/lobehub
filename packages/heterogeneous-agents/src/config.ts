export type HeterogeneousAgentMenuLabelKey = 'newClaudeCodeAgent' | 'newCodexAgent';

/**
 * Config for local CLI hetero agents (Claude Code, Codex) that run as
 * desktop subprocesses via Electron IPC. Remote device agents (openclaw,
 * hermes) have their own setup flow and are not listed here.
 */
export interface HeterogeneousAgentConfig {
  command: string;
  iconId: string;
  menuKey: string;
  menuLabelKey: HeterogeneousAgentMenuLabelKey;
  title: string;
  type: 'claude-code' | 'codex';
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

export const getHeterogeneousAgentConfig = (type: string) =>
  HETEROGENEOUS_AGENT_CONFIGS.find((config) => config.type === type);

/**
 * Config for remote platform hetero agents that communicate back via
 * agentNotify.notify. Unlike local CLI agents these are always bound to
 * a device via `lh connect` and do not run as desktop subprocesses.
 * Add new remote platform types here to automatically propagate display
 * names across the UI (model tag, loading indicator, agent list, etc.).
 */
export interface RemoteHeterogeneousAgentConfig {
  title: string;
  type: 'amp' | 'hermes' | 'opencode' | 'openclaw';
}

export const REMOTE_HETEROGENEOUS_AGENT_CONFIGS = [
  { title: 'OpenClaw', type: 'openclaw' },
  { title: 'Hermes', type: 'hermes' },
  { title: 'Amp', type: 'amp' },
  { title: 'OpenCode', type: 'opencode' },
] as const satisfies readonly RemoteHeterogeneousAgentConfig[];

/** Union of all local CLI hetero types. */
export type LocalHeterogeneousAgentType = (typeof HETEROGENEOUS_AGENT_CONFIGS)[number]['type'];

/** Union of all remote platform hetero types. */
export type RemoteHeterogeneousAgentType =
  (typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'];

/** Union of every supported hetero agent type. */
export type HeterogeneousAgentType = LocalHeterogeneousAgentType | RemoteHeterogeneousAgentType;

const REMOTE_HETERO_TYPES = new Set<string>(REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((c) => c.type));

/** Returns true when `type` identifies a remote platform agent (openclaw, hermes, …). */
export const isRemoteHeterogeneousType = (type: string): type is RemoteHeterogeneousAgentType =>
  REMOTE_HETERO_TYPES.has(type);
