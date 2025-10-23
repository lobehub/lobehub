import {
  EditLocalFileParams,
  GetCommandOutputParams,
  GlobFilesParams,
  GrepContentParams,
  KillCommandParams,
  ListLocalFileParams,
  LocalMoveFilesResultItem,
  LocalReadFileParams,
  LocalReadFilesParams,
  LocalSearchFilesParams,
  MoveLocalFilesParams,
  RenameLocalFileParams,
  RunCommandParams,
  WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import { StateCreator } from 'zustand/vanilla';

import { localFileService } from '@/services/electron/localFileService';
import { ChatStore } from '@/store/chat/store';
import {
  EditLocalFileState,
  GetCommandOutputState,
  GlobFilesState,
  GrepContentState,
  KillCommandState,
  LocalFileListState,
  LocalFileSearchState,
  LocalMoveFilesState,
  LocalReadFileState,
  LocalReadFilesState,
  LocalRenameFileState,
  RunCommandState,
} from '@/tools/local-system/type';

/* eslint-disable typescript-sort-keys/interface */
export interface LocalFileAction {
  internal_triggerLocalFileToolCalling: <T = any>(
    id: string,
    callingService: () => Promise<{ content: any; state?: T }>,
  ) => Promise<boolean>;

  // File Operations
  listLocalFiles: (id: string, params: ListLocalFileParams) => Promise<boolean>;
  moveLocalFiles: (id: string, params: MoveLocalFilesParams) => Promise<boolean>;
  readLocalFile: (id: string, params: LocalReadFileParams) => Promise<boolean>;
  readLocalFiles: (id: string, params: LocalReadFilesParams) => Promise<boolean>;
  renameLocalFile: (id: string, params: RenameLocalFileParams) => Promise<boolean>;
  reSearchLocalFiles: (id: string, params: LocalSearchFilesParams) => Promise<boolean>;
  searchLocalFiles: (id: string, params: LocalSearchFilesParams) => Promise<boolean>;
  toggleLocalFileLoading: (id: string, loading: boolean) => void;
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

/* eslint-disable sort-keys-fix/sort-keys-fix */
export const localSystemSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  LocalFileAction
> = (set, get) => ({
  // ==================== File Editing ====================
  editLocalFile: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<EditLocalFileState>(id, async () => {
      const result = await localFileService.editLocalFile(params);

      const message = result.success
        ? `Successfully replaced ${result.replacements} occurrence(s) in ${params.file_path}`
        : `Edit failed: ${result.error}`;

      const state: EditLocalFileState = { message, result };

      return { content: result, state };
    });
  },

  writeLocalFile: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling(id, async () => {
      const result = await localFileService.writeFile(params);

      let content: { message: string; success: boolean };

      if (result.success) {
        content = {
          message: `成功写入文件 ${params.path}`,
          success: true,
        };
      } else {
        const errorMessage = result.error;

        content = { message: errorMessage || '写入文件失败', success: false };
      }
      return { content };
    });
  },
  moveLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<LocalMoveFilesState>(id, async () => {
      const results: LocalMoveFilesResultItem[] = await localFileService.moveLocalFiles(params);

      // 检查所有文件是否成功移动以更新消息内容
      const allSucceeded = results.every((r) => r.success);
      const someFailed = results.some((r) => !r.success);
      const successCount = results.filter((r) => r.success).length;
      const failedCount = results.length - successCount;

      let message = '';

      if (allSucceeded) {
        message = `Successfully moved ${results.length} item(s).`;
      } else if (someFailed) {
        message = `Moved ${successCount} item(s) successfully. Failed to move ${failedCount} item(s).`;
      } else {
        // 所有都失败了？
        message = `Failed to move all ${results.length} item(s).`;
      }

      const state: LocalMoveFilesState = { results, successCount, totalCount: results.length };

      return { content: { message, results }, state };
    });
  },
  renameLocalFile: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<LocalRenameFileState>(id, async () => {
      const { path: currentPath, newName } = params;

      // Basic validation for newName (can be done here or backend, maybe better in backend)
      if (
        !newName ||
        newName.includes('/') ||
        newName.includes('\\') ||
        newName === '.' ||
        newName === '..' ||
        /["*/:<>?\\|]/.test(newName)
      ) {
        throw new Error(
          'Invalid new name provided. It cannot be empty, contain path separators, or invalid characters.',
        );
      }

      const result = await localFileService.renameLocalFile({ newName, path: currentPath }); // Call the specific service

      let state: LocalRenameFileState;
      let content: { message: string; success: boolean };

      if (result.success) {
        state = { newPath: result.newPath!, oldPath: currentPath, success: true };
        // Simplified message
        content = {
          message: `Successfully renamed file ${currentPath} to ${newName}.`,
          success: true,
        };
      } else {
        const errorMessage = result.error;
        state = {
          error: errorMessage,
          newPath: '',
          oldPath: params.path,
          success: false,
        };
        content = { message: errorMessage, success: false };
      }
      return { content, state };
    });
  },

  // ==================== Search & Find ====================
  grepContent: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<GrepContentState>(id, async () => {
      const result = await localFileService.grepContent(params);

      const message = result.success
        ? `Found ${result.total_matches} matches in ${result.matches.length} locations`
        : 'Search failed';

      const state: GrepContentState = { message, result };

      return { content: result, state };
    });
  },

  globLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<GlobFilesState>(id, async () => {
      const result = await localFileService.globFiles(params);

      const message = result.success ? `Found ${result.total_files} files` : 'Glob search failed';

      const state: GlobFilesState = { message, result };

      return { content: result, state };
    });
  },

  searchLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<LocalFileSearchState>(id, async () => {
      const result = await localFileService.searchLocalFiles(params);
      const state: LocalFileSearchState = { searchResults: result };
      return { content: result, state };
    });
  },

  listLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<LocalFileListState>(id, async () => {
      const result = await localFileService.listLocalFiles(params);
      const state: LocalFileListState = { listResults: result };
      return { content: result, state };
    });
  },

  reSearchLocalFiles: async (id, params) => {
    get().toggleLocalFileLoading(id, true);

    await get().updatePluginArguments(id, params);

    return get().searchLocalFiles(id, params);
  },

  readLocalFile: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<LocalReadFileState>(id, async () => {
      const result = await localFileService.readLocalFile(params);
      const state: LocalReadFileState = { fileContent: result };
      return { content: result, state };
    });
  },

  readLocalFiles: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<LocalReadFilesState>(id, async () => {
      const results = await localFileService.readLocalFiles(params);
      const state: LocalReadFilesState = { filesContent: results };
      return { content: results, state };
    });
  },

  // ==================== Shell Commands ====================
  runCommand: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<RunCommandState>(id, async () => {
      const result = await localFileService.runCommand(params);

      let message: string;

      if (result.success) {
        if (result.shell_id) {
          message = `Command started in background with shell_id: ${result.shell_id}`;
        } else {
          message = `Command completed successfully. Exit code: ${result.exit_code}`;
        }
      } else {
        message = `Command failed: ${result.error}`;
      }

      const state: RunCommandState = { message, result };

      return { content: result, state };
    });
  },
  killCommand: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<KillCommandState>(id, async () => {
      const result = await localFileService.killCommand(params);

      const message = result.success
        ? `Successfully killed shell: ${params.shell_id}`
        : `Failed to kill shell: ${result.error}`;

      const state: KillCommandState = { message, result };

      return { content: result, state };
    });
  },
  getCommandOutput: async (id, params) => {
    return get().internal_triggerLocalFileToolCalling<GetCommandOutputState>(id, async () => {
      const result = await localFileService.getCommandOutput(params);

      const message = result.success
        ? `Output retrieved. Running: ${result.running}`
        : `Failed: ${result.error}`;

      const state: GetCommandOutputState = { message, result };

      return { content: result, state };
    });
  },

  // ==================== utils ====================

  toggleLocalFileLoading: (id, loading) => {
    // Assuming a loading state structure similar to searchLoading
    set(
      (state) => ({
        localFileLoading: { ...state.localFileLoading, [id]: loading },
      }),
      false,
      `toggleLocalFileLoading/${loading ? 'start' : 'end'}`,
    );
  },
  internal_triggerLocalFileToolCalling: async (id, callingService) => {
    get().toggleLocalFileLoading(id, true);
    try {
      const { state, content } = await callingService();
      if (state) {
        await get().updatePluginState(id, state as any);
      }
      await get().internal_updateMessageContent(id, JSON.stringify(content));
    } catch (error) {
      await get().internal_updateMessagePluginError(id, {
        body: error,
        message: (error as Error).message,
        type: 'PluginServerError',
      });
    }
    get().toggleLocalFileLoading(id, false);

    return true;
  },
});
