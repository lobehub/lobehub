import debug from 'debug';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import { userService } from '@/services/user';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { invokeExecutor } from './executors/index';
import { type BuiltinToolContext, type BuiltinToolResult } from './types';

const n = setNamespace('builtinTool');
const log = debug('lobe-store:builtin-tool');

const UNINSTALLED_BUILTIN_TOOLS = 'loadUninstalledBuiltinTools';

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
   * Install a builtin tool by removing it from the uninstalled list
   */
  installBuiltinTool = async (identifier: string): Promise<void> => {
    const currentUninstalled = this.#get().uninstalledBuiltinTools;

    if (!currentUninstalled.includes(identifier)) return;

    const newUninstalled = currentUninstalled.filter((id) => id !== identifier);

    // Optimistic update
    this.#set({ uninstalledBuiltinTools: newUninstalled }, false, n('installBuiltinTool'));

    // Persist to user settings
    await userService.updateUserSettings({
      tool: { uninstalledBuiltinTools: newUninstalled },
    });

    // Refresh to ensure consistency
    await this.refreshUninstalledBuiltinTools();
  };

  /**
   * Uninstall a builtin tool by adding it to the uninstalled list
   */
  uninstallBuiltinTool = async (identifier: string): Promise<void> => {
    const currentUninstalled = this.#get().uninstalledBuiltinTools;

    if (currentUninstalled.includes(identifier)) return;

    const newUninstalled = [...currentUninstalled, identifier];

    // Optimistic update
    this.#set({ uninstalledBuiltinTools: newUninstalled }, false, n('uninstallBuiltinTool'));

    // Persist to user settings
    await userService.updateUserSettings({
      tool: { uninstalledBuiltinTools: newUninstalled },
    });

    // Refresh to ensure consistency
    await this.refreshUninstalledBuiltinTools();
  };

  /**
   * Refresh uninstalled builtin tools from server
   */
  refreshUninstalledBuiltinTools = async (): Promise<void> => {
    await mutate(UNINSTALLED_BUILTIN_TOOLS);
  };

  /**
   * SWR hook to fetch uninstalled builtin tools
   */
  useFetchUninstalledBuiltinTools = (enabled: boolean): SWRResponse<string[]> => {
    return useSWR<string[]>(
      enabled ? UNINSTALLED_BUILTIN_TOOLS : null,
      async () => {
        const userState = await userService.getUserState();
        return userState?.settings?.tool?.uninstalledBuiltinTools ?? [];
      },
      {
        fallbackData: [],
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
