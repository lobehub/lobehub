import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';

import type { ActionTagData } from './types';

/**
 * Collects all available slash-selectable skills/tools and returns them as ActionTagData[].
 */
export const useEnabledSkills = (): ActionTagData[] => {
  // All data sources
  const builtinList = useToolStore(builtinToolSelectors.metaList, isEqual);
  const builtinSkills = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);
  const installedPlugins = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const klavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const lobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  return useMemo(() => {
    const items: ActionTagData[] = [];
    const skillNameMap = new Map<string, string>();
    const toolNameMap = new Map<string, string>();

    for (const item of builtinList) {
      toolNameMap.set(item.identifier, item.meta?.title || item.identifier);
    }
    for (const item of installedPlugins) {
      toolNameMap.set(item.identifier, item.title || item.identifier);
    }
    for (const item of klavisServers) {
      toolNameMap.set(item.identifier, item.serverName || item.identifier);
    }
    for (const item of lobehubSkillServers) {
      toolNameMap.set(item.identifier, item.name || item.identifier);
    }

    for (const item of builtinSkills) {
      skillNameMap.set(item.identifier, item.name || item.identifier);
    }
    for (const item of marketAgentSkills) {
      skillNameMap.set(item.identifier, item.name || item.identifier);
    }
    for (const item of userAgentSkills) {
      skillNameMap.set(item.identifier, item.name || item.identifier);
    }

    for (const [id, label] of skillNameMap) {
      items.push({ category: 'skill', label, type: id });
    }

    for (const [id, label] of toolNameMap) {
      items.push({ category: 'tool', label, type: id });
    }

    return items;
  }, [
    builtinList,
    builtinSkills,
    installedPlugins,
    klavisServers,
    lobehubSkillServers,
    marketAgentSkills,
    userAgentSkills,
  ]);
};
