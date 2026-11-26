import { getUserDisabledToolIds } from '@lobechat/builtin-tools';
import {
  applyConnectorActivation,
  type ConnectorActivation,
  hasConnectorActivator,
  resolveConnectorActivation,
} from '@lobechat/mecha';
import {
  type AgentPluginEntry,
  getActivePluginIds,
  getOptedInPluginIds,
  resolveToolMode,
} from '@lobechat/types';

import { getToolStoreState } from '@/store/tool';
import type { ToolStoreState } from '@/store/tool/initialState';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore/types';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import { lobehubSkillStoreSelectors } from '@/store/tool/slices/lobehubSkillStore/selectors';
import type { LobeAgentChatConfig } from '@/types/agent';

/**
 * Every identifier the browser knows as a connector: MCP connectors, Composio
 * and LobeHub connections, installed plugins. A builtin tool or a skill that
 * shares a row with one of those sources is not a connector — it keeps its own
 * three-state policy.
 */
export const getConnectorIdentifiers = (s: ToolStoreState = getToolStoreState()): string[] => {
  const notConnectors = new Set([
    ...(s.builtinTools || []).map((tool) => tool.identifier),
    ...(s.builtinSkills || []).map((skill) => skill.identifier),
    ...agentSkillsSelectors.getAgentSkills(s).map((skill) => skill.identifier),
  ]);

  return [
    ...new Set([
      ...(s.connectors ?? []).map((connector) => connector.identifier),
      ...Object.values(s.agentConnectors ?? {}).flatMap((connectors) =>
        connectors.map((connector) => connector.identifier),
      ),
      ...(s.installedPlugins || []).map((plugin) => plugin.identifier),
      ...(s.composioServers || []).map((server) => server.identifier),
      ...(s.lobehubSkillServers || []).map((server) => server.identifier),
    ]),
  ].filter((identifier) => !notConnectors.has(identifier));
};

/** Connected tools visible to this agent in the current account or workspace. */
export const getConnectedConnectorIds = (
  s: ToolStoreState,
  agentId: string,
  connectorIds = getConnectorIdentifiers(s),
): string[] => {
  const connected = new Set([
    ...connectorSelectors.connectedMcpConnectorsForAgent(s, agentId).map((c) => c.identifier),
    ...(s.installedPlugins ?? []).filter((p) => !p.customParams?.composio).map((p) => p.identifier),
    ...(s.composioServers ?? [])
      .filter(
        (c) => c.status === ComposioServerStatus.ACTIVE && (!c.agentId || c.agentId === agentId),
      )
      .map((c) => c.identifier),
    ...lobehubSkillStoreSelectors.getConnectedServers(s).map((c) => c.identifier),
  ]);
  return connectorIds.filter((id) => connected.has(id));
};

export interface AgentConnectorActivation {
  activation: ConnectorActivation;
  connectorIds: string[];
  /** Connectors the agent has off: they leave every pool the run reads. */
  offIds: string[];
}

/**
 * The connector rule (`resolveConnectorActivation`) over the browser's stores:
 * uses the executing agent's mode and explicit overrides.
 */
export const resolveAgentConnectorActivation = (
  agent: {
    id?: string;
    chatConfig?: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'toolMode'>;
    enabledPluginIds?: readonly string[];
    /** The raw `plugins` field, before it is collapsed to pinned identifiers. */
    plugins?: AgentPluginEntry[];
  },
  /** Identifiers this turn brings in by itself (an @-mention, a runtime addition). */
  turnIds: readonly string[] = [],
  toolState: ToolStoreState = getToolStoreState(),
): AgentConnectorActivation => {
  const disabledIds = getUserDisabledToolIds(agent.plugins, agent.chatConfig);
  const connectorIds = getConnectorIdentifiers(toolState);
  const available = new Set(getConnectedConnectorIds(toolState, agent.id ?? '', connectorIds));
  const unavailable = connectorIds.filter((id) => !available.has(id));
  const activation = resolveConnectorActivation({
    disabledIds: [...disabledIds, ...unavailable],
    discoverByDefault: resolveToolMode(agent.chatConfig) === 'agent',
    hasActivator: hasConnectorActivator(
      agent.chatConfig,
      [...(agent.enabledPluginIds ?? getActivePluginIds(agent.plugins)), ...turnIds],
      disabledIds,
    ),
    optedInIds: getOptedInPluginIds(agent.plugins),
    turnIds: turnIds.filter((id) => !unavailable.includes(id)),
  });

  return {
    activation,
    connectorIds,
    offIds: connectorIds.filter((identifier) => !activation.isAllowed(identifier)),
  };
};

/**
 * The invocation candidates once the connector rule is applied: a connector
 * that is on leaves them (the activator finds it) unless the turn brings it in
 * or the run has no activator. Builtin tools and skills are left as listed.
 */
export const applyAgentConnectorActivation = (
  candidateIds: readonly string[],
  connectors: AgentConnectorActivation,
): string[] =>
  applyConnectorActivation(candidateIds, connectors.connectorIds, connectors.activation);
