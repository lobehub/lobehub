import { type CustomPluginParams, type LobeTool } from '@lobechat/types';

import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';

/**
 * The installed-plugins list is not paged and not filtered: it is one entry per
 * cache scope (`${userId}:${workspace}`), so every sync shares these params and
 * personal / each workspace keep independent rows automatically.
 */
export const INSTALLED_PLUGINS_KEY = 'installed';

export type InstalledPluginsParams = Record<string, never>;

export const INSTALLED_PLUGINS_PARAMS: InstalledPluginsParams = {};

/**
 * Installed plugins (`user_installed_plugins`): read by the skill settings page,
 * the chat input tool picker, the agent profile and the MCP detail pages, and
 * written by install / uninstall / settings updates. A local-first replica
 * paints the persisted display projection on the first frame and lets the
 * network confirm the full records in the background.
 */
export const installedPluginsResource = defineReplica<InstalledPluginsParams, LobeTool[]>({
  key: () => INSTALLED_PLUGINS_KEY,
  name: 'installedPlugins',
  storage: 'indexedDB',
  version: 1,
});

/** Plugins are addressed by `identifier` across the tool store. */
export const installedPluginsEntity: ReplicaEntityAdapter<LobeTool[], LobeTool> =
  arrayEntity<LobeTool>((plugin) => plugin.identifier);

/**
 * Reduce a plugin record to what the first frame paints: identity, manifest
 * (name, icon, API list) and the two non-secret discriminators display
 * selectors filter on.
 *
 * `settings` and the rest of `customParams` stay in memory only. Plugin
 * settings are usually API keys, and `customParams.mcp` carries the connection:
 * URL, command / args, `env`, `headers` and the bearer / OAuth `token` /
 * `accessToken` / `clientSecret`. Persisted projection rows outlive the session
 * (sign-out only moves the active scope), so writing them to IndexedDB would
 * turn an authenticated response into durable plaintext credentials.
 *
 * Kept on purpose:
 * - `customParams.mcp.type` — `isInstalledPluginAvailableInCurrentEnv` reads it
 *   to keep a `stdio` plugin off the web; dropping it would surface the cached
 *   plugin there until the network answers.
 * - `customParams.composio` as `{ appSlug, status }` — `installedPluginMetaList`
 *   only checks its presence to leave Composio rows to their own surface.
 *
 * A row hydrated from this projection is display-only: the full-record
 * selectors (`pluginSelectors.confirmedInstalledPlugins` and the by-id record
 * lookups) and every write wait for the server-confirmed list.
 */
export const toInstalledPluginProjection = (plugin: LobeTool): LobeTool => {
  const { customParams, identifier, manifest, runtimeType, source, type } = plugin;
  const row: LobeTool = { identifier, type };
  if (manifest !== undefined) row.manifest = manifest;
  if (runtimeType !== undefined) row.runtimeType = runtimeType;
  if (source !== undefined) row.source = source;

  const mcpType = customParams?.mcp?.type;
  const composio = customParams?.composio;
  if (mcpType || composio) {
    const params: CustomPluginParams = {};
    if (mcpType) params.mcp = { type: mcpType };
    if (composio)
      params.composio = {
        appSlug: composio.appSlug,
        status: composio.status,
      } as CustomPluginParams['composio'];
    row.customParams = params;
  }

  return row;
};

/** `toPersisted` of the installed-plugins replica: rows only, never the index. */
export const toInstalledPluginsProjection = (plugins: LobeTool[]): LobeTool[] =>
  plugins.map(toInstalledPluginProjection);
