import { DESKTOP_STDIO_EXECUTION_KEY } from '@lobechat/const';
import { merge } from 'es-toolkit/compat';

import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { type StoreSetter } from '@/store/types';
import { type LobeToolCustomPlugin, type PluginInstallError } from '@/types/tool/plugin';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { restoreConnector, snapshotReplacedConnector } from '../connector/replaceConnector';
import { pluginSelectors } from '../plugin/selectors';

const n = setNamespace('customPlugin');

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
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
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

  /**
   * Rediscover a legacy custom MCP's tools. `saved` is the configuration an
   * edit just stored: the loaded row still holds the previous server until the
   * list refreshes, so reading it would list the old server's tools.
   */
  reinstallCustomPlugin = async (id: string, saved?: LobeToolCustomPlugin): Promise<void> => {
    const plugin = saved ?? pluginSelectors.getCustomPluginById(id)(this.#get());
    if (!plugin) return;

    const { refreshPlugins, updateInstallError, updateInstallLoadingState } = this.#get();

    const url = plugin.customParams?.mcp?.url;
    if (!plugin.customParams?.mcp || !url) return;

    try {
      updateInstallError(id, undefined);
      updateInstallLoadingState(id, true);
      const manifest = await mcpService.getStreamableMcpServerManifest({
        auth: plugin.customParams.mcp.auth,
        headers: plugin.customParams.mcp.headers,
        identifier: plugin.identifier,
        metadata: {
          avatar: plugin.customParams.avatar,
          description: plugin.customParams.description,
        },
        url,
      });
      await pluginService.updatePluginManifest(id, manifest);
      await refreshPlugins();
    } catch (error) {
      console.error(error);
      const err = error as PluginInstallError;
      updateInstallError(id, { cause: err.cause, message: err.message });
    } finally {
      updateInstallLoadingState(id, false);
    }
  };

  uninstallCustomPlugin = async (id: string): Promise<void> => {
    await this.#get().uninstallPlugin(id);
  };

  updateCustomPlugin = async (id: string, value: LobeToolCustomPlugin): Promise<void> => {
    const { reinstallCustomPlugin } = this.#get();
    // 1. Update list item information
    await pluginService.updatePlugin(id, value);

    // 2. Reinstall plugin from the values just saved
    await reinstallCustomPlugin(id, value);
  };

  updateNewCustomPlugin = (newCustomPlugin: Partial<LobeToolCustomPlugin>): void => {
    this.#set(
      { newCustomPlugin: merge({}, this.#get().newCustomPlugin, newCustomPlugin) },
      false,
      n('updateNewDevPlugin'),
    );
  };
}

export type CustomPluginAction = Pick<CustomPluginActionImpl, keyof CustomPluginActionImpl>;
