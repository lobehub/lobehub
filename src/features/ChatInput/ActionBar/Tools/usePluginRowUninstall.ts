import { useCallback } from 'react';

import { useToolStore } from '@/store/tool';

interface PluginRow {
  identifier: string;
  runtimeType?: string;
  type: string;
}

/**
 * The picker's Delete for a plugin row. A community MCP reinstalled since
 * connectors keeps its legacy row beside the marketplace connector it runs on,
 * and the picker lists only the row, so its Delete goes through
 * `uninstallMCPPlugin`, which removes both, as Settings' Uninstall does. Any
 * other row is the plugin alone.
 */
export const usePluginRowUninstall = () => {
  const [uninstallPlugin, uninstallMCPPlugin] = useToolStore((s) => [
    s.uninstallCustomPlugin,
    s.uninstallMCPPlugin,
  ]);

  return useCallback(
    ({ identifier, runtimeType, type }: PluginRow) =>
      type !== 'customPlugin' && runtimeType === 'mcp'
        ? uninstallMCPPlugin(identifier)
        : uninstallPlugin(identifier),
    [uninstallMCPPlugin, uninstallPlugin],
  );
};
