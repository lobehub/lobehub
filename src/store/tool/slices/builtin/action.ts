import { defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import debug from 'debug';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { createReplicaSlice, type ReplicaLens, type ReplicaSyncResult } from '@/libs/replica';
import { userService } from '@/services/user';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { invokeExecutor } from './executors/index';
import {
  resolveUninstalledBuiltinTools,
  UNINSTALLED_BUILTIN_TOOLS_KEY,
  uninstalledBuiltinToolsResource,
} from './projection';
import { type BuiltinToolContext, type BuiltinToolResult } from './types';

const n = setNamespace('builtinTool');
const log = debug('lobe-store:builtin-tool');

/**
 * The uninstalled-tools list keeps its long-standing flat `uninstalledBuiltinTools`
 * field as the replica view, so every selector keeps reading what it did. The
 * init flag gates `get`: before the first hydrate / replace the view must read
 * `undefined`, otherwise the default seed would block hydration from storage.
 * The default seed stays the first-frame value (what the server resolves for a
 * never-configured scope), so an un-hydrated replica still reads as "not yet
 * filled" rather than as "everything is uninstalled".
 */
const uninstalledBuiltinToolsLens: ReplicaLens<ToolStore, string[]> = {
  clear: () => ({
    isUninstalledBuiltinToolsInit: false,
    uninstalledBuiltinTools: defaultUninstalledBuiltinTools,
  }),
  get: (state) => (state.isUninstalledBuiltinToolsInit ? state.uninstalledBuiltinTools : undefined),
  keys: (state) => (state.isUninstalledBuiltinToolsInit ? [UNINSTALLED_BUILTIN_TOOLS_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { isUninstalledBuiltinToolsInit: true, uninstalledBuiltinTools: data }
      : {
          isUninstalledBuiltinToolsInit: false,
          uninstalledBuiltinTools: defaultUninstalledBuiltinTools,
        },
};

/**
 * Builtin Tool Action Interface
 */

type Setter = StoreSetter<ToolStore>;
export const createBuiltinToolSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new BuiltinToolActionImpl(set, get, _api);

export class BuiltinToolActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;
  readonly #uninstalledBuiltinTools;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#uninstalledBuiltinTools = createReplicaSlice(uninstalledBuiltinToolsResource, {
      actionPrefix: n('uninstalledBuiltinTools'),
      fetcher: async ({ workspaceId }) => {
        const userState = await userService.getUserState();
        return resolveUninstalledBuiltinTools(userState?.settings?.tool, workspaceId);
      },
      get,
      set,
      stateKey: 'uninstalledBuiltinToolsReplica',
      view: uninstalledBuiltinToolsLens,
    });
  }

  invokeBuiltinTool = async (
    identifier: string,
    apiName: string,
    params: any,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const executorKey = `${identifier}/${apiName}`;
    log('invokeBuiltinTool: %s', executorKey);

    const { toggleBuiltinToolLoading } = this.#get();
    toggleBuiltinToolLoading(executorKey, true);

    try {
      const result = await invokeExecutor(identifier, apiName, params, ctx);
      log('invokeBuiltinTool result: %s -> %o', executorKey, result);

      toggleBuiltinToolLoading(executorKey, false);
      return result;
    } catch (error) {
      log('invokeBuiltinTool error: %s -> %o', executorKey, error);
      toggleBuiltinToolLoading(executorKey, false);

      return {
        error: {
          body: error,
          message: error instanceof Error ? error.message : String(error),
          type: 'BuiltinToolExecutorError',
        },
        success: false,
      };
    }
  };

  toggleBuiltinToolLoading = (key: string, value: boolean): void => {
    this.#set({ builtinToolLoading: { [key]: value } }, false, n('toggleBuiltinToolLoading'));
  };

  transformApiArgumentsToAiState = async (
    key: string,
    params: any,
  ): Promise<string | undefined> => {
    const { builtinToolLoading, toggleBuiltinToolLoading } = this.#get();
    if (builtinToolLoading[key]) return;

    const { [key as keyof BuiltinToolAction]: action } = this.#get();

    if (!action) return JSON.stringify(params);

    toggleBuiltinToolLoading(key, true);

    try {
      // @ts-ignore
      const result = await action(params);

      toggleBuiltinToolLoading(key, false);

      return JSON.stringify(result);
    } catch (e) {
      toggleBuiltinToolLoading(key, false);
      throw e;
    }
  };

  // ========== Uninstalled Builtin Tools Management ==========

  /** The replica scope a request starts under; its result may only land there. */
  #isCurrentScope = (scope: string): boolean =>
    this.#uninstalledBuiltinTools.resource.scope.get() === scope;

  /**
   * Toggle a builtin tool's installed state for the active scope (personal or
   * workspace), persisting to the matching slot in user settings.
   *
   * The current list is read fresh from the server so the diff is against the
   * real stored value (not the default seed, and not a possibly-stale persisted
   * copy). Persistence goes through the scope-targeted server-side patch
   * (`updateUninstalledBuiltinTools`), which replaces only this scope's slot
   * atomically — writing the whole `tool` column from a snapshot would race
   * with concurrent tool-column writers (e.g. an approvalMode change from
   * another tab) and could revert them.
   */
  #toggleBuiltinToolInstalled = async (identifier: string, install: boolean): Promise<void> => {
    const workspaceId = getActiveWorkspaceId();
    // The identity the request starts under. `getUserState()` below can resolve
    // after the user switched workspace, so the captured scope is re-checked
    // before the replica is written (see the guard after the read).
    const scope = this.#uninstalledBuiltinTools.resource.scope.get();

    const userState = await userService.getUserState();
    const tool = userState?.settings?.tool;
    const currentUninstalled = resolveUninstalledBuiltinTools(tool, workspaceId);

    const alreadyUninstalled = currentUninstalled.includes(identifier);
    // No-op if the tool is already in the desired state.
    if (install ? !alreadyUninstalled : alreadyUninstalled) return;

    const newUninstalled = install
      ? currentUninstalled.filter((id) => id !== identifier)
      : [...currentUninstalled, identifier];

    // The active identity changed while we read the server: keep the write
    // pinned to the workspace the toggle started in, but never update the
    // switched-to scope's replica with this list. The optimistic overlay would
    // paint it into the scope now on screen and persist it there, and a
    // rejected write would keep that wrong base — the follow-up refresh cannot
    // repair a scope whose sync query is not mounted. Mirrors the connector /
    // agent-skill actions' late-response guard.
    if (!this.#isCurrentScope(scope)) {
      await userService.updateUninstalledBuiltinTools(newUninstalled, workspaceId);
      return;
    }

    // Adopt the freshly-read list when the replica has not painted yet: an
    // un-initialized replica drops an optimistic write, so without this base
    // the toggle would only appear once the revalidation below lands.
    if (!this.#get().isUninstalledBuiltinToolsInit) {
      this.#uninstalledBuiltinTools.update(UNINSTALLED_BUILTIN_TOOLS_KEY, () => currentUninstalled);
    }

    // The replica shows the new list immediately and rolls it back when the
    // server rejects the write; the confirmed list is then persisted as this
    // scope's local-first copy.
    await this.#uninstalledBuiltinTools.optimistic(
      UNINSTALLED_BUILTIN_TOOLS_KEY,
      () => newUninstalled,
      () => userService.updateUninstalledBuiltinTools(newUninstalled, workspaceId),
    );

    // Refresh to ensure consistency.
    await this.refreshUninstalledBuiltinTools();
  };

  /**
   * Install a builtin tool by removing it from the uninstalled list
   */
  installBuiltinTool = async (identifier: string): Promise<void> => {
    await this.#toggleBuiltinToolInstalled(identifier, true);
  };

  /**
   * Uninstall a builtin tool by adding it to the uninstalled list
   */
  uninstallBuiltinTool = async (identifier: string): Promise<void> => {
    await this.#toggleBuiltinToolInstalled(identifier, false);
  };

  /**
   * Refresh the uninstalled-tools replica: the painted list stays on screen
   * while the network answers, instead of blanking to the default seed first.
   */
  refreshUninstalledBuiltinTools = async (): Promise<void> => {
    await this.#uninstalledBuiltinTools.revalidate(UNINSTALLED_BUILTIN_TOOLS_KEY);
  };

  /**
   * Fetch orchestration for the uninstalled-builtin list. The replica is
   * partitioned by the active identity (personal / each workspace), so a scope
   * switch paints that scope's persisted copy on the first frame; combined with
   * the SPA's per-workspace remount this revalidates automatically.
   *
   * Read the list through `builtinToolSelectors.uninstalledBuiltinTools`; this
   * only schedules the network round-trip.
   */
  useFetchUninstalledBuiltinTools = (enabled: boolean): ReplicaSyncResult => {
    const workspaceId = useActiveWorkspaceId();

    return this.#uninstalledBuiltinTools.useSync(
      { workspaceId },
      { enabled, revalidateOnFocus: false },
    );
  };
}

export type BuiltinToolAction = Pick<BuiltinToolActionImpl, keyof BuiltinToolActionImpl>;
