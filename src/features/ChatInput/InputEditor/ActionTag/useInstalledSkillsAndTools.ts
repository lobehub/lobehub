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
 * Collects all installed skills and tools, returning them as ActionTagData[].
 * Skills: builtinSkills, lobehubSkillServers, marketAgentSkills, userAgentSkills
 * Tools:  installedPlugins (excluding skill-type entries), klavisServers
 */
export const useInstalledSkillsAndTools = (): ActionTagData[] => {
  const builtinSkills = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);
  const installedPlugins = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const klavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const lobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  return useMemo(() => {
    const items: ActionTagData[] = [];

    // --- Build skill set (identifier → { label, icon }) ---
    const skillMap = new Map<string, { icon?: string; label: string }>();

    for (const item of builtinSkills) {
      skillMap.set(item.identifier, { icon: item.avatar, label: item.name || item.identifier });
    }
    for (const item of lobehubSkillServers) {
      if (!skillMap.has(item.identifier)) {
        skillMap.set(item.identifier, { icon: item.icon, label: item.name || item.identifier });
      }
    }
    for (const item of marketAgentSkills) {
      if (!skillMap.has(item.identifier)) {
        skillMap.set(item.identifier, { label: item.name || item.identifier });
      }
    }
    for (const item of userAgentSkills) {
      if (!skillMap.has(item.identifier)) {
        skillMap.set(item.identifier, { label: item.name || item.identifier });
      }
    }

    // --- Build tool set, excluding identifiers already classified as skills ---
    const toolMap = new Map<string, { icon?: string; label: string }>();

    for (const item of installedPlugins) {
      // Skip entries that are actually skills (lobehub skill, agent skill, builtin skill)
      if (skillMap.has(item.identifier)) continue;
      if (!toolMap.has(item.identifier)) {
        toolMap.set(item.identifier, { icon: item.avatar, label: item.title || item.identifier });
      }
    }
    for (const item of klavisServers) {
      if (skillMap.has(item.identifier)) continue;
      if (!toolMap.has(item.identifier)) {
        toolMap.set(item.identifier, {
          icon: item.icon,
          label: item.serverName || item.identifier,
        });
      }
    }

    // --- Merge into output ---
    for (const [id, { icon, label }] of skillMap) {
      items.push({ category: 'skill', icon, label, type: id });
    }
    for (const [id, { icon, label }] of toolMap) {
      items.push({ category: 'tool', icon, label, type: id });
    }

    return items;
  }, [
    builtinSkills,
    installedPlugins,
    klavisServers,
    lobehubSkillServers,
    marketAgentSkills,
    userAgentSkills,
  ]);
};
