import { isDesktop } from '@lobechat/const';

import { shouldEnableBuiltinSkill } from './skillFilters';
import { shouldEnableTool } from './toolFilters';

export interface ToolAvailabilityInstalledPlugin {
  customParams?: {
    mcp?: {
      type?: string;
    } | null;
  } | null;
  identifier: string;
}

export interface ToolAvailabilityContext {
  installedPlugins?: ToolAvailabilityInstalledPlugin[];
  isDesktop?: boolean;
}

export const isBuiltinToolAvailableInCurrentEnv = (id: string) => shouldEnableTool(id);

export const isBuiltinSkillAvailableInCurrentEnv = (
  id: string,
  context: Omit<ToolAvailabilityContext, 'installedPlugins'> = {},
) => {
  if (context.isDesktop === undefined) {
    return shouldEnableBuiltinSkill(id);
  }

  return shouldEnableBuiltinSkill(id, {
    isDesktop: context.isDesktop ?? isDesktop,
  });
};

export const isInstalledPluginAvailableInCurrentEnv = (
  plugin: ToolAvailabilityInstalledPlugin,
  context: Omit<ToolAvailabilityContext, 'installedPlugins'> = {},
) => (context.isDesktop ?? isDesktop) || plugin.customParams?.mcp?.type !== 'stdio';

export const isToolAvailableInCurrentEnv = (id: string, context: ToolAvailabilityContext = {}) => {
  if (!isBuiltinToolAvailableInCurrentEnv(id)) return false;
  if (!isBuiltinSkillAvailableInCurrentEnv(id, context)) return false;

  const plugin = context.installedPlugins?.find((item) => item.identifier === id);

  if (!plugin) return true;

  return isInstalledPluginAvailableInCurrentEnv(plugin, context);
};

export const filterToolIdsByCurrentEnv = (ids: string[], context: ToolAvailabilityContext = {}) =>
  ids.filter((id) => isToolAvailableInCurrentEnv(id, context));
