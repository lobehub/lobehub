import { type LobeTool } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type PluginInstallError } from '@/types/tool/plugin';

export type PluginsSettings = Record<string, any>;

export interface PluginState {
  /**
   * Installed plugins of the active scope — the view of the `installedPlugins`
   * replica. Until the server answers it can hold the persisted display
   * projection (no `settings`, no connection parameters): read full records
   * through `pluginSelectors.confirmedInstalledPlugins` and the by-id lookups.
   */
  installedPlugins: LobeTool[];
  /** Replica bookkeeping for `installedPlugins`. */
  installedPluginsReplica: ReplicaState<LobeTool[]>;
  /**
   * Whether the installed-plugins view has been filled (from storage or the
   * server). Gates the replica lens: an un-loaded list must read `undefined`,
   * otherwise hydration would treat the empty default as a real value.
   */
  isInstalledPluginsInit: boolean;
  pluginInstallErrors: Record<string, PluginInstallError | undefined>;
  pluginInstallLoading: Record<string, boolean | undefined>;
  /** Lets a newer settings write abort the one still in flight. */
  updatePluginSettingsSignal?: AbortController;
}

export const initialPluginState: PluginState = {
  installedPlugins: [],
  installedPluginsReplica: createReplicaState(),
  isInstalledPluginsInit: false,
  pluginInstallErrors: {},
  pluginInstallLoading: {},
};
