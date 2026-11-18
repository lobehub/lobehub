import { getUserDisabledToolIds } from '@lobechat/builtin-tools';
import {
  applyConnectorActivation,
  type ConnectorActivation,
  hasConnectorActivator,
  resolveConnectorActivation,
} from '@lobechat/mecha';
import { type AgentPluginEntry, getActivePluginIds, getOptedInPluginIds } from '@lobechat/types';

import { getToolStoreState } from '@/store/tool';
import type { ToolStoreState } from '@/store/tool/initialState';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
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

export interface AgentConnectorActivation {
  activation: ConnectorActivation;
  connectorIds: string[];
  /** Connectors the agent has off: they leave every pool the run reads. */
  offIds: string[];
}

/**
 * The connector rule (`resolveConnectorActivation`) over the browser's stores:
 * a connector is on only when the agent's `plugins` carries an entry for it
 * that is not disabled.
 */
export const resolveAgentConnectorActivation = (
  agent: {
    chatConfig?: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'skillActivateMode' | 'toolMode'>;
    enabledPluginIds?: readonly string[];
    /** The raw `plugins` field, before it is collapsed to pinned identifiers. */
    plugins?: AgentPluginEntry[];
  },
  /** Identifiers this turn brings in by itself (an @-mention, a runtime addition). */
  turnIds: readonly string[] = [],
  toolState: ToolStoreState = getToolStoreState(),
): AgentConnectorActivation => {
  const activation = resolveConnectorActivation({
    hasActivator: hasConnectorActivator(
      agent.chatConfig,
      [...(agent.enabledPluginIds ?? getActivePluginIds(agent.plugins)), ...turnIds],
      getUserDisabledToolIds(agent.plugins, agent.chatConfig),
    ),
    optedInIds: getOptedInPluginIds(agent.plugins),
    turnIds,
  });
  const connectorIds = getConnectorIdentifiers(toolState);

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
