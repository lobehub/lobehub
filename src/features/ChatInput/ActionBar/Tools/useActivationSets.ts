import { getLegacyDisabledBuiltinToolIds, onDemandBuiltinToolIds } from '@lobechat/builtin-tools';
import { type AgentPluginEntry, getBuiltinOverrides } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import {
  getConnectedConnectorIds,
  getConnectorIdentifiers,
} from '@/helpers/toolEngineering/connectorActivation';
import { useToolStore } from '@/store/tool';

import { resolveDisabledIds } from './librarySkillPolicy';

/**
 * The identifier sets the Tools popover groups its rows by.
 *
 * Connected tools and configurable builtins default to on-demand (`auto`) in
 * Agent mode and require an explicit entry in Chat / Custom modes. A legacy
 * `pinned` entry reads as on, so rows are strictly two-state (on-demand vs disabled).
 */
export const resolveActivationSets = ({
  connectedConnectorIds,
  connectorIds: connectorIdList,
  discoverBuiltins = true,
  uninstalled = [],
  rawPlugins,
}: {
  connectedConnectorIds: readonly string[];
  connectorIds: readonly string[];
  discoverBuiltins?: boolean;
  /** The agent's raw `plugins` field, disabled and `auto` entries included. */
  rawPlugins: AgentPluginEntry[] | undefined;
  uninstalled?: readonly string[];
}) => {
  const connectorIds = new Set(connectorIdList);
  const connected = new Set(connectedConnectorIds);
  const optInIds = new Set(discoverBuiltins ? [] : connectorIdList);

  return {
    connectorIds,
    disabledIdSet: new Set([
      ...getLegacyDisabledBuiltinToolIds(uninstalled, getBuiltinOverrides(rawPlugins)),
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
  const uninstalled = useToolStore((s) => s.uninstalledBuiltinTools);

  return useMemo(
    () =>
      resolveActivationSets({
        connectedConnectorIds,
        connectorIds,
        discoverBuiltins,
        rawPlugins,
        uninstalled,
      }),
    [connectedConnectorIds, connectorIds, discoverBuiltins, rawPlugins, uninstalled],
  );
};
