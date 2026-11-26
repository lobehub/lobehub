import { DESKTOP_STDIO_EXECUTION_KEY } from '@lobechat/const';

import { type StoreSetter } from '@/store/types';

import { type ToolStore } from '../../store';
import { restoreConnector, snapshotReplacedConnector } from '../connector/replaceConnector';
import { pluginSelectors } from '../plugin/selectors';

export interface CustomMcpConnectorParams {
  config: {
    args?: string[];
    command?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    type: 'http' | 'stdio';
    url?: string;
  };
  description?: string;
  icon?: string;
  identifier: string;
  name?: string;
}

type Setter = StoreSetter<ToolStore>;
export const createCustomPluginSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new CustomPluginActionImpl(set, get, _api);

export class CustomPluginActionImpl {
  readonly #get: () => ToolStore;
  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#get = get;
  }

  /**
   * Add a custom MCP server from a protocol link as a `custom` connector and
   * sync its tools. Its stdio calls keep running on the desktop, as the custom
   * plugin's did. When the tool sync fails, a row this call created is removed
   * again and a row it reinstalled over is restored. Once it succeeds, a legacy
   * custom plugin of the same identifier is removed: the connector runs its
   * calls now, while the lists would show that plugin in its place, so their
   * Configure and Delete would act on the plugin alone.
   */
  installCustomMcpConnector = async ({
    config,
    description,
    icon,
    identifier,
    name,
  }: CustomMcpConnectorParams): Promise<void> => {
    const {
      createConnector,
      deleteConnector,
      refreshPlugins,
      syncConnectorTools,
      uninstallPlugin,
    } = this.#get();
    const isHttp = config.type === 'http';
    // Set whatever the transport: it can be edited to stdio later
    const metadata: Record<string, unknown> = {
      avatar: icon,
      description,
      [DESKTOP_STDIO_EXECUTION_KEY]: true,
    };
    if (isHttp && config.headers && Object.keys(config.headers).length > 0)
      metadata.customHeaders = config.headers;

    const snapshot = await snapshotReplacedConnector(identifier, 'custom', this.#get);
    const { id, isNew } = await createConnector({
      identifier,
      mcpConnectionType: config.type,
      mcpServerUrl: isHttp ? config.url?.trim() : undefined,
      mcpStdioConfig: isHttp
        ? undefined
        : { args: config.args ?? [], command: (config.command ?? '').trim(), env: config.env },
      metadata,
      name: name || identifier,
      sourceType: 'custom',
    });
    try {
      // A reinstall's tool list replaces the stored one
      await syncConnectorTools(id, { pruneMissingAutoTools: true });
    } catch (error) {
      const rollback = isNew
        ? deleteConnector(id)
        : snapshot
          ? restoreConnector(snapshot, this.#get)
          : undefined;
      await rollback?.catch((rollbackError) => {
        console.error('[customMcp] rollback of connector %s failed:', id, rollbackError);
      });
      throw error;
    }

    // The install itself succeeded: a plugin row left behind is only logged
    try {
      // The protocol-install popup mounts no plugin list: ask the server
      await refreshPlugins();
      if (!pluginSelectors.getCustomPluginById(identifier)(this.#get())) return;
      await uninstallPlugin(identifier);
    } catch (error) {
      console.error('[customMcp] removing legacy custom plugin %s failed:', identifier, error);
    }
  };

  uninstallCustomPlugin = async (id: string): Promise<void> => {
    await this.#get().uninstallPlugin(id);
  };
}

export type CustomPluginAction = Pick<CustomPluginActionImpl, keyof CustomPluginActionImpl>;
