import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';

import type { ActionTagData } from './types';

/**
 * Collects all installed skills and tools, returning them as ActionTagData[].
 * Skills: builtinSkills, lobehubSkillServers, marketAgentSkills, userAgentSkills
 * Tools:  installedPlugins (excluding skill-type entries), composioServers
 */
export const useInstalledSkillsAndTools = (): ActionTagData[] => {
  const builtinSkills = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);
  const customConnectors = useToolStore(connectorSelectors.customConnectors, isEqual);
  const installedPlugins = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const composioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
  const lobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  return useMemo(() => {
    const items: ActionTagData[] = [];

    // --- Build skill set (identifier → { label, icon }) ---
    const skillMap = new Map<string, { description?: string; icon?: string; label: string }>();

    for (const item of builtinSkills) {
      skillMap.set(item.identifier, {
        description: item.description,
        icon: item.avatar,
        label: item.title || item.name || item.identifier,
      });
    }
    for (const item of lobehubSkillServers) {
      if (!skillMap.has(item.identifier)) {
        skillMap.set(item.identifier, { icon: item.icon, label: item.name || item.identifier });
      }
    }
    for (const item of marketAgentSkills) {
      if (!skillMap.has(item.identifier)) {
        skillMap.set(item.identifier, {
          description: item.description || item.manifest?.description,
          label: item.name || item.identifier,
        });
      }
    }
    for (const item of userAgentSkills) {
      if (!skillMap.has(item.identifier)) {
        skillMap.set(item.identifier, {
          description: item.description || item.manifest?.description,
          label: item.name || item.identifier,
        });
      }
    }

    // --- Build tool set, excluding identifiers already classified as skills ---
    const toolMap = new Map<string, { icon?: string; label: string }>();

    // Custom connectors (user-added MCP servers) first: they take priority over
    // a legacy plugin sharing the same identifier, mirroring toolEngineering's
    // connector-over-plugin rule. Only enabled connectors with synced tools are
    // in the tools engine (buildClientConnectorManifests), so match that here —
    // otherwise the picker would offer a mention that resolves to nothing.
    for (const item of customConnectors) {
      if (!item.isEnabled || (item.tools?.length ?? 0) === 0) continue;
      if (skillMap.has(item.identifier)) continue;
      if (!toolMap.has(item.identifier)) {
        toolMap.set(item.identifier, { label: item.name || item.identifier });
      }
    }

    for (const item of installedPlugins) {
      // Skip entries that are actually skills (lobehub skill, agent skill, builtin skill)
      if (skillMap.has(item.identifier)) continue;
      if (!toolMap.has(item.identifier)) {
        toolMap.set(item.identifier, { icon: item.avatar, label: item.title || item.identifier });
      }
    }
    for (const item of composioServers) {
      if (skillMap.has(item.identifier)) continue;
      if (!toolMap.has(item.identifier)) {
        toolMap.set(item.identifier, {
          icon: item.icon,
          label: item.label || item.identifier,
        });
      }
    }

    // --- Merge into output ---
    for (const [id, { description, icon, label }] of skillMap) {
      items.push({ category: 'skill', description, icon, label, type: id });
    }
    for (const [id, { icon, label }] of toolMap) {
      items.push({ category: 'tool', icon, label, type: id });
    }

    return items;
  }, [
    builtinSkills,
    customConnectors,
    installedPlugins,
    composioServers,
    lobehubSkillServers,
    marketAgentSkills,
    userAgentSkills,
  ]);
};
