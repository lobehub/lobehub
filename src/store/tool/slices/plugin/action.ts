import { type Schema, type ValidationResult } from '@cfworker/json-schema';
import { type LobeTool } from '@lobechat/types';
import { type ReadResourceResult } from '@modelcontextprotocol/client';
import { type SWRResponse } from 'swr';

import { createReplicaSlice, type ReplicaLens, type ReplicaSyncResult } from '@/libs/replica';
import { subscribeCacheScope } from '@/libs/replica/cacheScopeEvents';
import { useClientDataSWR } from '@/libs/swr';
import { mcpAppKeys } from '@/libs/swr/keys';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { type StoreSetter } from '@/store/types';
import { type PluginInstallError } from '@/types/tool/plugin';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import {
  INSTALLED_PLUGINS_KEY,
  INSTALLED_PLUGINS_PARAMS,
  installedPluginsEntity,
  installedPluginsResource,
  toInstalledPluginsProjection,
} from './projection';
import { pluginSelectors } from './selectors';

const n = setNamespace('plugin');

/**
 * The installed plugins keep their long-standing flat `installedPlugins` field
 * as the replica view, so every selector and direct reader keeps reading what it
 * did. The init flag gates `get`: before the first hydrate / replace the view
 * must read `undefined`, otherwise the empty default would block hydration from
 * storage.
 */
const installedPluginsLens: ReplicaLens<ToolStore, LobeTool[]> = {
  clear: () => ({ installedPlugins: [], isInstalledPluginsInit: false }),
  get: (state) => (state.isInstalledPluginsInit ? state.installedPlugins : undefined),
  keys: (state) => (state.isInstalledPluginsInit ? [INSTALLED_PLUGINS_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { installedPlugins: data, isInstalledPluginsInit: true }
      : { installedPlugins: [], isInstalledPluginsInit: false },
};

type Setter = StoreSetter<ToolStore>;
export const createPluginSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new PluginActionImpl(set, get, _api);

export class PluginActionImpl {
  readonly #get: () => ToolStore;
  readonly #installedPlugins;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#installedPlugins = createReplicaSlice(installedPluginsResource, {
      actionPrefix: n('installedPlugins'),
      entity: installedPluginsEntity,
      fetcher: () => pluginService.getInstalledPlugins(),
      get,
      set,
      stateKey: 'installedPluginsReplica',
      // Settings and connection parameters never reach IndexedDB.
      toPersisted: toInstalledPluginsProjection,
      view: installedPluginsLens,
    });

    // Tool assembly and execution read the installed plugins outside any
    // component, and `refreshPlugins` runs on routes that do not mount
    // `useFetchInstalledPlugins`. Without a mounted sync nothing would reset the
    // view on a workspace / account switch until the next dispatch, so the
    // previous identity's plugins (connection parameters included) would stay
    // runnable. Drop them the moment the scope changes. The store is an
    // app-lifetime singleton, so the subscription is never torn down.
    subscribeCacheScope((scope) => this.#installedPlugins.ensureScope(scope));
  }

  /**
   * Fetch the installed plugins and confirm the replica with them. The painted
   * list stays on screen while the network answers.
   *
   * Imperative on purpose: install / uninstall / migration flows call it on
   * routes (e.g. the protocol-install popup) where no `useFetchInstalledPlugins`
   * is mounted, so revalidating the mounted sync queries would resolve without
   * fetching anything. The scope is captured before the request so a response
   * that lands after a workspace switch is dropped instead of written into the
   * next scope. Every mutation ends with this refresh, so it is `fresh`: it
   * retires the requests already in flight (sync or refresh), which started
   * before the mutation and would paint the pre-mutation list. Rejects when
   * the fetch fails.
   */
  refreshPlugins = async (): Promise<void> => {
    await this.#installedPlugins.fetch(INSTALLED_PLUGINS_PARAMS, { fresh: true });
  };

  /**
   * Uninstall a plugin. The row stays until the server confirms (a detail pane
   * bound to it would otherwise blank and blink back on a rejected delete),
   * then leaves the loaded list *and* the persisted rows: `removeEntity` also
   * guards hydrates already in flight, so a reload never paints the uninstalled
   * plugin again.
   */
  uninstallPlugin = async (identifier: string): Promise<void> => {
    await this.removeInstalledPluginRecord(identifier);
    await this.#get().refreshPlugins();
  };

  removeInstalledPluginLocalRecord = (identifier: string): void => {
    this.#installedPlugins.removeEntity(identifier);
  };

  removeInstalledPluginRecord = async (identifier: string): Promise<void> => {
    await pluginService.uninstallPlugin(identifier);
    this.removeInstalledPluginLocalRecord(identifier);
  };

  updateInstallLoadingState = (id: string, loading: boolean | undefined): void => {
    this.#set(
      { pluginInstallLoading: { ...this.#get().pluginInstallLoading, [id]: loading } },
      false,
      'updateInstallLoadingState',
    );
  };

  updateInstallError = (id: string, error: PluginInstallError | undefined): void => {
    this.#set(
      { pluginInstallErrors: { ...this.#get().pluginInstallErrors, [id]: error } },
      false,
      'updateInstallError',
    );
  };

  /**
   * Fetch orchestration for the installed plugins: hydrate the persisted display
   * projection, then confirm the full records from the server on the same SWR
   * schedule as before. Read the list through `pluginSelectors`; this only
   * reports fetch flags.
   */
  useFetchInstalledPlugins = (enable: boolean): ReplicaSyncResult =>
    this.#installedPlugins.useSync(INSTALLED_PLUGINS_PARAMS, { enabled: enable });

  /**
   * The `ui://` resource (HTML view) an MCP App tool result renders with, read
   * from `server`, the one the tool ran on, as `agentId`'s runs resolve it, and
   * where it ran (`onThisDevice`). `toolArguments` carry the account the tool
   * ran as when its connector holds several. The HTML is only the view's: it
   * stays in this request's cache, not in the store.
   */
  useFetchMcpAppResource = (
    identifier: string,
    resourceUri: string,
    {
      agentId,
      linkId,
      onThisDevice = false,
      server,
      toolArguments,
      topicId,
    }: {
      agentId?: string;
      /** The account the view acts as, when its arguments cannot name one. */
      linkId?: string;
      onThisDevice?: boolean;
      server?: string;
      toolArguments?: string;
      topicId?: string;
    },
  ): SWRResponse<ReadResourceResult | undefined> =>
    useClientDataSWR(
      mcpAppKeys.resource(identifier, resourceUri, {
        agentId,
        linkId,
        onThisDevice,
        server,
        toolArguments,
        topicId,
      }),
      () =>
        mcpService.readMcpAppResource(identifier, resourceUri, {
          agentId,
          linkId,
          onThisDevice,
          server,
          toolArguments,
          topicId,
        }),
      { revalidateOnFocus: false, revalidateOnReconnect: false },
    );

  validatePluginSettings = async (identifier: string): Promise<ValidationResult | undefined> => {
    // Validate the full record: the display projection has no settings, so it
    // would report every required field as missing.
    const plugin = pluginSelectors.getInstalledPluginById(identifier)(this.#get());
    const manifest = plugin?.manifest;
    if (!manifest || !manifest.settings) return;
    const settings = pluginSelectors.getPluginSettingsById(identifier)(this.#get());

    // validate the settings
    const { Validator } = await import('@cfworker/json-schema');
    const validator = new Validator(manifest.settings as Schema);
    const result = validator.validate(settings);

    if (!result.valid) return { errors: result.errors, valid: false };

    return { errors: [], valid: true };
  };
}

export type PluginAction = Pick<PluginActionImpl, keyof PluginActionImpl>;
