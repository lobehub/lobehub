import { defineReplica } from '@/libs/replica';

export { resolveUninstalledBuiltinTools } from '@lobechat/builtin-tools';

/**
 * The uninstalled-builtin list is one entry: the active identity
 * (`${userId}:${workspaceId ?? 'personal'}`) already partitions memory and
 * storage, so the entry key is a constant and personal / each workspace keep
 * independent rows automatically.
 */
export const UNINSTALLED_BUILTIN_TOOLS_KEY = 'uninstalled';

export interface UninstalledBuiltinToolsParams {
  /** Active workspace id, or `null` for the personal scope. */
  workspaceId: string | null;
}

/**
 * Uninstalled builtin tools (`settings.tool.uninstalledBuiltinTools` /
 * `uninstalledBuiltinToolsByWorkspace`): the user's own list, read on the
 * settings, skill-store and chat-input surfaces and written by install /
 * uninstall. A local-first replica paints the persisted list on the first
 * frame and lets the network confirm it in the background.
 *
 * The params carry the workspace the list belongs to so the fetch resolves the
 * matching slot even if the user switches workspace while the request is in
 * flight; the params do not change the entry key.
 */
export const uninstalledBuiltinToolsResource = defineReplica<
  UninstalledBuiltinToolsParams,
  string[]
>({
  key: () => UNINSTALLED_BUILTIN_TOOLS_KEY,
  name: 'uninstalledBuiltinTools',
  storage: 'indexedDB',
  version: 1,
});
