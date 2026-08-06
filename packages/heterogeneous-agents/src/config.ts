export type HeterogeneousAgentMenuLabelKey =
  | 'newAmpAgent'
  | 'newClaudeCodeAgent'
  | 'newCodexAgent'
  | 'newOpenCodeAgent'
  | 'newPiAgent'
  | 'newQoderAgent';

/**
 * Config for local CLI hetero agents (Amp, Claude Code, Codex, OpenCode, Pi, Qoder) that run as
 * desktop subprocesses via Electron IPC. Platform task agents (openclaw,
 * hermes) use a separate notify-based runner and are not listed here.
 */
export interface HeterogeneousAgentConfig {
  command: string;
  iconId: string;
  menuKey: string;
  menuLabelKey: HeterogeneousAgentMenuLabelKey;
  title: string;
  type: 'amp' | 'claude-code' | 'codex' | 'opencode' | 'pi' | 'qoder';
}

export const HETEROGENEOUS_AGENT_CONFIGS = [
  {
    command: 'amp',
    iconId: 'Amp',
    menuKey: 'newAmpAgent',
    menuLabelKey: 'newAmpAgent',
    title: 'Amp',
    type: 'amp',
  },
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
  {
    command: 'opencode',
    iconId: 'OpenCode',
    menuKey: 'newOpenCodeAgent',
    menuLabelKey: 'newOpenCodeAgent',
    title: 'OpenCode',
    type: 'opencode',
  },
  {
    command: 'pi',
    iconId: 'Pi',
    menuKey: 'newPiAgent',
    menuLabelKey: 'newPiAgent',
    title: 'Pi',
    type: 'pi',
  },
  {
    command: 'qodercli',
    iconId: 'Qoder',
    menuKey: 'newQoderAgent',
    menuLabelKey: 'newQoderAgent',
    title: 'Qoder',
    type: 'qoder',
  },
] as const satisfies readonly HeterogeneousAgentConfig[];

export const getHeterogeneousAgentConfig = (type: string) =>
  HETEROGENEOUS_AGENT_CONFIGS.find((config) => config.type === type);

/**
 * Config for platform task hetero agents that communicate back via
 * agentNotify.notify. They can run on this desktop or a connected device,
 * but use a different execution protocol from local CLI stream adapters.
 * Add new remote platform types here to automatically propagate display
 * names across the UI (model tag, loading indicator, agent list, etc.).
 */
export interface RemoteHeterogeneousAgentConfig {
  title: string;
  type: 'hermes' | 'openclaw';
}

export const REMOTE_HETEROGENEOUS_AGENT_CONFIGS = [
  { title: 'OpenClaw', type: 'openclaw' },
  { title: 'Hermes', type: 'hermes' },
] as const satisfies readonly RemoteHeterogeneousAgentConfig[];

/** Union of all local CLI hetero types. */
export type LocalHeterogeneousAgentType = (typeof HETEROGENEOUS_AGENT_CONFIGS)[number]['type'];

/** Union of all notify-based platform task hetero types. */
export type RemoteHeterogeneousAgentType =
  (typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'];

/** Union of every supported hetero agent type. */
export type HeterogeneousAgentType = LocalHeterogeneousAgentType | RemoteHeterogeneousAgentType;

const REMOTE_HETERO_TYPES = new Set<string>(REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((c) => c.type));

/** Returns true when `type` identifies a notify-based platform agent. */
export const isRemoteHeterogeneousType = (type: string): type is RemoteHeterogeneousAgentType =>
  REMOTE_HETERO_TYPES.has(type);
