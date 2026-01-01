import {
  type EditLocalFileParams,
  type GetCommandOutputParams,
  type GlobFilesParams,
  type GrepContentParams,
  type KillCommandParams,
  type ListLocalFileParams,
  type LocalReadFileParams,
  type LocalReadFilesParams,
  type LocalSearchFilesParams,
  type MoveLocalFilesParams,
  type RenameLocalFileParams,
  type RunCommandParams,
  type WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import debug from 'debug';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { LocalSystemExecutionRuntime } from '@/tools/local-system/ExecutionRuntime';

const log = debug('lobe-store:builtin-tool');

/* eslint-disable typescript-sort-keys/interface */
export interface LocalFileAction {
  internal_triggerLocalFileToolCalling: (
    id: string,
    callingService: () => Promise<{ content: string; error?: any; state?: any; success: boolean }>,
  ) => Promise<boolean>;

  // File Operations
  listLocalFiles: (id: string, params: ListLocalFileParams) => Promise<boolean>;
  moveLocalFiles: (id: string, params: MoveLocalFilesParams) => Promise<boolean>;
  readLocalFile: (id: string, params: LocalReadFileParams) => Promise<boolean>;
  readLocalFiles: (id: string, params: LocalReadFilesParams) => Promise<boolean>;
  renameLocalFile: (id: string, params: RenameLocalFileParams) => Promise<boolean>;
  reSearchLocalFiles: (id: string, params: LocalSearchFilesParams) => Promise<boolean>;
  searchLocalFiles: (id: string, params: LocalSearchFilesParams) => Promise<boolean>;
  writeLocalFile: (id: string, params: WriteLocalFileParams) => Promise<boolean>;

  // Shell Commands
  editLocalFile: (id: string, params: EditLocalFileParams) => Promise<boolean>;
  getCommandOutput: (id: string, params: GetCommandOutputParams) => Promise<boolean>;
  killCommand: (id: string, params: KillCommandParams) => Promise<boolean>;
  runCommand: (id: string, params: RunCommandParams) => Promise<boolean>;

  // Search & Find
  globLocalFiles: (id: string, params: GlobFilesParams) => Promise<boolean>;
  grepContent: (id: string, params: GrepContentParams) => Promise<boolean>;
}
/* eslint-enable typescript-sort-keys/interface */

const runtime = new LocalSystemExecutionRuntime();

/* eslint-disable sort-keys-fix/sort-keys-fix */
export const localSystemSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  LocalFileAction
> = (set, get) => ({
  // ==================== File Editing ====================
  editLocalFile: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.editLocalFile(params);
    });
  },

  writeLocalFile: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.writeLocalFile(params);
    });
  },
  moveLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.moveLocalFiles(params);
    });
  },
  renameLocalFile: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.renameLocalFile(params);
    });
  },

  // ==================== Search & Find ====================
  grepContent: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.grepContent(params);
    });
  },

  globLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.globLocalFiles(params);
    });
  },

  searchLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.searchLocalFiles(params);
    });
  },

  listLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.listLocalFiles(params);
    });
  },

  reSearchLocalFiles: async (id, params) => {
    // Get operationId from messageOperationMap to ensure proper context isolation
    const operationId = get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    await get().optimisticUpdatePluginArguments(id, params, false, context);

    return get().searchLocalFiles(id, params);
  },

  readLocalFile: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.readLocalFile(params);
    });
  },

  readLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.readLocalFiles(params);
    });
  },

  // ==================== Shell Commands ====================
  runCommand: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.runCommand(params);
    });
  },
  killCommand: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.killCommand(params);
    });
  },
  getCommandOutput: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      return await runtime.getCommandOutput(params);
    });
  },

  // ==================== utils ====================

  internal_triggerLocalFileToolCalling: async (id, callingService) => {
    // Get parent operationId from messageOperationMap (should be executeToolCall)
    const parentOperationId = get().messageOperationMap[id];

    // Create child operation for local system execution
    // Auto-associates message with this operation via messageId in context
    const { operationId: localSystemOpId, abortController } = get().startOperation({
      type: 'builtinToolLocalSystem',
      context: {
        messageId: id,
      },
      parentOperationId,
      metadata: {
        startTime: Date.now(),
      },
    });

    log(
      '[localSystem] messageId=%s, parentOpId=%s, localSystemOpId=%s, aborted=%s',
      id,
      parentOperationId,
      localSystemOpId,
      abortController.signal.aborted,
    );

    const context = { operationId: localSystemOpId };

    try {
      const { state, content, success, error } = await callingService();

      // Complete local system operation
      get().completeOperation(localSystemOpId);

      if (success) {
        if (state) {
          await get().optimisticUpdatePluginState(id, state, context);
        }
        await get().optimisticUpdateMessageContent(id, content, undefined, context);
      } else {
        await get().optimisticUpdateMessagePluginError(
          id,
          {
            body: error,
            message: error?.message || 'Operation failed',
            type: 'PluginServerError',
          },
          context,
        );
        // Still update content even if failed, to show error message
        await get().optimisticUpdateMessageContent(id, content, undefined, context);
      }

      return true;
    } catch (error) {
      const err = error as Error;

      log('[localSystem] Error: messageId=%s, error=%s', id, err.message);

      // Check if it's an abort error
      if (err.message.includes('The user aborted a request.') || err.name === 'AbortError') {
        log('[localSystem] Request aborted: messageId=%s', id);
        // Fail local system operation for abort
        get().failOperation(localSystemOpId, {
          message: 'User cancelled the request',
          type: 'UserAborted',
        });
        // Don't update error message for user aborts
        return false;
      }

      // Fail local system operation for other errors
      get().failOperation(localSystemOpId, {
        message: err.message,
        type: 'PluginServerError',
      });

      // For other errors, update message
      await get().optimisticUpdateMessagePluginError(
        id,
        {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        context,
      );

      return false;
    }
  },
});
