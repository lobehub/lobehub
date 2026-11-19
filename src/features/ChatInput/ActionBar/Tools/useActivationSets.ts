import { onDemandBuiltinToolIds } from '@lobechat/builtin-tools';
import { type AgentPluginEntry, type AgentPluginMode } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import {
  getConnectedConnectorIds,
  getConnectorIdentifiers,
} from '@/helpers/toolEngineering/connectorActivation';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';

import { resolveDisabledIds } from './librarySkillPolicy';

/** A connector is two-state: on (found on demand) or off. It cannot be pinned. */
export const CONNECTOR_MODES: AgentPluginMode[] = ['auto', 'disabled'];

/**
 * The identifier sets the Tools popover groups its rows by.
 *
 * Library skills require an explicit entry. Connected tools default to Auto in
 * agent mode and require an entry in custom toolsets. A connector also has no Pinned
 * state: an entry pinned before it lost that state reads as on, so it is listed
 * under Auto rather than Pinned.
 */
export const resolveActivationSets = ({
  connectedConnectorIds,
  connectorIds: connectorIdList,
  librarySkillIds,
  discoverBuiltins = true,
  pinnedIds,
  rawPlugins,
}: {
  discoverBuiltins?: boolean;
  connectedConnectorIds: readonly string[];
  connectorIds: readonly string[];
  librarySkillIds: readonly string[];
  /** The agent's pinned identifiers. */
  pinnedIds: readonly string[];
  /** The agent's raw `plugins` field, disabled and `auto` entries included. */
  rawPlugins: AgentPluginEntry[] | undefined;
}) => {
  const connectorIds = new Set(connectorIdList);
  const connected = new Set(connectedConnectorIds);
  const optInIds = new Set(
    discoverBuiltins ? librarySkillIds : [...librarySkillIds, ...connectorIdList],
  );

  return {
    checkedSet: new Set(
      pinnedIds.filter((id) => !connectorIds.has(id) && !onDemandBuiltinToolIds.includes(id)),
    ),
    connectorIds,
    disabledIdSet: new Set([
      ...connectorIdList.filter((id) => !connected.has(id)),
      ...resolveDisabledIds(
        rawPlugins,
        discoverBuiltins ? optInIds : [...optInIds, ...onDemandBuiltinToolIds],
      ),
    ]),
    /** Identifiers that are off without an entry, so Auto must be written explicitly. */
    optInIds,
  };
};

/** {@link resolveActivationSets} over the tool store. */
export const useActivationSets = (
  agentId: string,
  pinnedIds: string[],
  rawPlugins: AgentPluginEntry[] | undefined,
  discoverBuiltins: boolean,
) => {
  const { connectorIds, connectedConnectorIds } = useToolStore((state) => {
    const connectorIds = getConnectorIdentifiers(state);
    return {
      connectorIds,
      connectedConnectorIds: getConnectedConnectorIds(state, agentId, connectorIds),
    };
  }, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  return useMemo(
    () =>
      resolveActivationSets({
        connectedConnectorIds,
        connectorIds,
        discoverBuiltins,
        librarySkillIds: [...marketAgentSkills, ...userAgentSkills].map(
          (skill) => skill.identifier,
        ),
        pinnedIds,
        rawPlugins,
      }),
    [
      connectedConnectorIds,
      connectorIds,
      discoverBuiltins,
      marketAgentSkills,
      userAgentSkills,
      pinnedIds,
      rawPlugins,
    ],
  );
};
