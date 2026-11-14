import { useToolStore } from '@/store/tool';

/**
 * Load what decides whether a plugin or MCP is installed: the legacy plugin
 * rows, and the connectors a marketplace MCP install now lands in
 * (`pluginSelectors.isPluginInstalled` reads both).
 */
export const useFetchInstalledPlugins = () => {
  // `isConnectorsInit` drops on a cache-scope switch: re-rendering then moves
  // the connector load to the new identity
  const [useFetchInstalledPlugins, useFetchConnectors] = useToolStore((s) => [
    s.useFetchInstalledPlugins,
    s.useFetchConnectors,
    s.isConnectorsInit,
  ]);

  useFetchConnectors(true);
  return useFetchInstalledPlugins(true);
};
