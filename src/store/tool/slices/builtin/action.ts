import { defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import debug from 'debug';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate } from '@/libs/swr';
import { toolKeys } from '@/libs/swr/keys';
import { userService } from '@/services/user';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { invokeExecutor } from './executors/index';
import { type BuiltinToolContext, type BuiltinToolResult } from './types';

const n = setNamespace('builtinTool');
const log = debug('lobe-store:builtin-tool');

/**
 * Minimal view of `settings.tool` covering just the builtin-tool install slots.
 * Typed locally so the helpers accept the loosened shape returned by
 * `getUserState()` while still spreading the rest of `tool` through at runtime.
 */
interface UninstalledBuiltinToolsScope {
  uninstalledBuiltinTools?: string[];
  uninstalledBuiltinToolsByWorkspace?: Record<string, string[] | undefined>;
}

/**
 * Resolve the uninstalled-builtin-tools list for the active scope.
 *
 * - Personal context (`workspaceId == null`) → the user's personal list.
 * - Workspace context → the per-workspace list; a workspace with no stored
 *   entry falls back to the default seed (a clean default state), never the
 *   user's personal customization.
 *
 * `undefined` (never configured) maps to the default seed in both scopes.
 */
const resolveUninstalledBuiltinTools = (
  tool: UninstalledBuiltinToolsScope | undefined,
  workspaceId: string | null,
): string[] => {
  const stored = workspaceId
    ? tool?.uninstalledBuiltinToolsByWorkspace?.[workspaceId]
    : tool?.uninstalledBuiltinTools;

  return stored === undefined ? defaultUninstalledBuiltinTools : stored;
};

/**
 * Build the full `tool` settings payload for persisting a new uninstalled list
 * in the active scope. The whole object is returned (not a partial) because the
 * server replaces the `tool` column wholesale on update — spreading the current
 * `tool` keeps `humanIntervention` and the other scope's list intact.
 */
const buildUninstalledToolsUpdate = <T extends UninstalledBuiltinToolsScope>(
  tool: T | undefined,
  workspaceId: string | null,
  nextUninstalled: string[],
) =>
  workspaceId
    ? {
        ...tool,
        uninstalledBuiltinToolsByWorkspace: {
          ...tool?.uninstalledBuiltinToolsByWorkspace,
          [workspaceId]: nextUninstalled,
        },
      }
    : { ...tool, uninstalledBuiltinTools: nextUninstalled };

/**
 * Builtin Tool Action Interface
 */

type Setter = StoreSetter<ToolStore>;
export const createBuiltinToolSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new BuiltinToolActionImpl(set, get, _api);

export class BuiltinToolActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
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

  /**
   * Toggle a builtin tool's installed state for the active scope (personal or
   * workspace), persisting to the matching slot in user settings.
   *
   * The current list is read fresh from the server so the diff is against the
   * real stored value (not the default seed), and the full `tool` object is
   * written back so the other scope's list and `humanIntervention` survive the
   * server's wholesale column replacement.
   */
  #toggleBuiltinToolInstalled = async (identifier: string, install: boolean): Promise<void> => {
    const workspaceId = getActiveWorkspaceId();

    const userState = await userService.getUserState();
    const tool = userState?.settings?.tool;
    const currentUninstalled = resolveUninstalledBuiltinTools(tool, workspaceId);

    const alreadyUninstalled = currentUninstalled.includes(identifier);
    // No-op if the tool is already in the desired state.
    if (install ? !alreadyUninstalled : alreadyUninstalled) return;

    const newUninstalled = install
      ? currentUninstalled.filter((id) => id !== identifier)
      : [...currentUninstalled, identifier];

    // Optimistic update
    this.#set(
      { uninstalledBuiltinTools: newUninstalled, uninstalledBuiltinToolsLoading: false },
      false,
      n(install ? 'installBuiltinTool' : 'uninstallBuiltinTool'),
    );

    // Persist to user settings (scoped to personal / active workspace)
    await userService.updateUserSettings({
      tool: buildUninstalledToolsUpdate(tool, workspaceId, newUninstalled),
    });

    // Refresh to ensure consistency
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
   * Refresh uninstalled builtin tools from server (active scope)
   */
  refreshUninstalledBuiltinTools = async (): Promise<void> => {
    await mutate(toolKeys.uninstalledBuiltins(getActiveWorkspaceId()));
  };

  /**
   * SWR hook to fetch uninstalled builtin tools for the active scope.
   *
   * The cache key carries the active workspace id so personal and each
   * workspace keep independent caches; combined with the SPA's per-workspace
   * remount this revalidates automatically on workspace switch.
   */
  useFetchUninstalledBuiltinTools = (enabled: boolean): SWRResponse<string[]> => {
    const workspaceId = useActiveWorkspaceId();

    return useSWR<string[]>(
      enabled ? toolKeys.uninstalledBuiltins(workspaceId) : null,
      async () => {
        const userState = await userService.getUserState();
        return resolveUninstalledBuiltinTools(userState?.settings?.tool, workspaceId);
      },
      {
        fallbackData: defaultUninstalledBuiltinTools,
        onSuccess: (data) => {
          this.#set(
            { uninstalledBuiltinTools: data, uninstalledBuiltinToolsLoading: false },
            false,
            n('useFetchUninstalledBuiltinTools'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  };
}

export type BuiltinToolAction = Pick<BuiltinToolActionImpl, keyof BuiltinToolActionImpl>;
