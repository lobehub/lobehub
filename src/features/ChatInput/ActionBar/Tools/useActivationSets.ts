import { onDemandBuiltinToolIds } from '@lobechat/builtin-tools';
import { type AgentPluginEntry, type AgentPluginMode } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { getConnectorIdentifiers } from '@/helpers/toolEngineering/connectorActivation';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';

import { resolveDisabledIds } from './librarySkillPolicy';

/** A connector is two-state: on (found on demand) or off. It cannot be pinned. */
export const CONNECTOR_MODES: AgentPluginMode[] = ['auto', 'disabled'];

/**
 * The identifier sets the Tools popover groups its rows by.
 *
 * Library skills and connectors are opt-in per agent — the profile is where one
 * is turned on — so having no entry means Disabled for them, where it means
 * Auto for a builtin tool or a builtin skill. A connector also has no Pinned
 * state: an entry pinned before it lost that state reads as on, so it is listed
 * under Auto rather than Pinned.
 */
export const resolveActivationSets = ({
  connectorIds: connectorIdList,
  librarySkillIds,
  pinnedIds,
  rawPlugins,
}: {
  connectorIds: readonly string[];
  librarySkillIds: readonly string[];
  /** The agent's pinned identifiers. */
  pinnedIds: readonly string[];
  /** The agent's raw `plugins` field, disabled and `auto` entries included. */
  rawPlugins: AgentPluginEntry[] | undefined;
}) => {
  const connectorIds = new Set(connectorIdList);
  const optInIds = new Set([...onDemandBuiltinToolIds, ...librarySkillIds, ...connectorIdList]);

  return {
    checkedSet: new Set(
      pinnedIds.filter((id) => !connectorIds.has(id) && !onDemandBuiltinToolIds.includes(id)),
    ),
    connectorIds,
    disabledIdSet: new Set(resolveDisabledIds(rawPlugins, optInIds)),
    /** Identifiers that are off without an entry, so Auto must be written explicitly. */
    optInIds,
  };
};

/** {@link resolveActivationSets} over the tool store. */
export const useActivationSets = (
  pinnedIds: string[],
  rawPlugins: AgentPluginEntry[] | undefined,
) => {
  const connectorIds = useToolStore(getConnectorIdentifiers, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  return useMemo(
    () =>
      resolveActivationSets({
        connectorIds,
        librarySkillIds: [...marketAgentSkills, ...userAgentSkills].map(
          (skill) => skill.identifier,
        ),
        pinnedIds,
        rawPlugins,
      }),
    [connectorIds, marketAgentSkills, userAgentSkills, pinnedIds, rawPlugins],
  );
};
