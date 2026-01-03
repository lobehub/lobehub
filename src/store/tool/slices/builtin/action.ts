import debug from 'debug';
import { type StateCreator } from 'zustand/vanilla';

import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { invokeExecutor } from './executors/index';
import type { BuiltinToolContext, BuiltinToolResult } from './types';

const n = setNamespace('builtinTool');
const log = debug('lobe-store:builtin-tool');

/**
 * Builtin Tool Action Interface
 */
export interface BuiltinToolAction {
  /**
   * Invoke a builtin tool executor
   *
   * @param identifier - Tool identifier (e.g., 'lobe-knowledge-base')
   * @param apiName - API name (e.g., 'searchKnowledgeBase')
   * @param params - Parameters parsed from tool call arguments
   * @param ctx - Execution context with messageId, operationId, signal, etc.
   * @returns BuiltinToolResult with content, state, error, success, stop
   */
  invokeBuiltinTool: (
    identifier: string,
    apiName: string,
    params: any,
    ctx: BuiltinToolContext,
  ) => Promise<BuiltinToolResult>;

  toggleBuiltinToolLoading: (key: string, value: boolean) => void;
  transformApiArgumentsToAiState: (key: string, params: any) => Promise<string | undefined>;
}

export const createBuiltinToolSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  BuiltinToolAction
> = (set, get) => ({
  invokeBuiltinTool: async (identifier, apiName, params, ctx) => {
    const executorKey = `${identifier}/${apiName}`;
    log('invokeBuiltinTool: %s', executorKey);

    const { toggleBuiltinToolLoading } = get();
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
  },

  toggleBuiltinToolLoading: (key, value) => {
    set({ builtinToolLoading: { [key]: value } }, false, n('toggleBuiltinToolLoading'));
  },

  transformApiArgumentsToAiState: async (key, params) => {
    const { builtinToolLoading, toggleBuiltinToolLoading } = get();
    if (builtinToolLoading[key]) return;

    const { [key as keyof BuiltinToolAction]: action } = get();

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
  },
});
