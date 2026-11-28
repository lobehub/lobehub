import type { LobeTool, LobeToolCustomPlugin } from '@lobechat/types';

export type LegacyMigrationPlugin =
  | (Omit<LobeToolCustomPlugin, 'type'> & { type: 'customPlugin' })
  | (Omit<LobeToolCustomPlugin, 'type'> & { type: 'plugin' });

/** Narrow a confirmed installed-plugin row to the legacy MCP shapes the migration modal accepts. */
export const asLegacyMigrationPlugin = (plugin?: LobeTool): LegacyMigrationPlugin | undefined => {
  if (
    !plugin ||
    (plugin.type !== 'customPlugin' && plugin.type !== 'plugin') ||
    !plugin.customParams?.mcp
  )
    return undefined;

  return {
    ...plugin,
    customParams: plugin.customParams ?? undefined,
    manifest: plugin.manifest ?? undefined,
    type: plugin.type,
  };
};
