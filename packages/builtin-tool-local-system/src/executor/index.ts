import type {
  EditLocalFileParams,
  EditLocalFileResult,
  GetCommandOutputParams,
  GetCommandOutputResult,
  GlobFilesParams,
  GlobFilesResult,
  GrepContentParams,
  GrepContentResult,
  KillCommandParams,
  KillCommandResult,
  ListLocalFileParams,
  LocalFileItem,
  LocalMoveFilesResultItem,
  LocalReadFileParams,
  LocalReadFileResult,
  LocalReadFilesParams,
  LocalSearchFilesParams,
  MoveLocalFilesParams,
  RenameLocalFileParams,
  RenameLocalFileResult,
  RunCommandParams,
  RunCommandResult,
  WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import { BaseExecutor, type BuiltinToolResult } from '@lobechat/types';

import { localFileService } from '@/services/electron/localFileService';

import {
  type EditLocalFileState,
  type GetCommandOutputState,
  type GlobFilesState,
  type GrepContentState,
  type KillCommandState,
  type LocalFileListState,
  type LocalFileSearchState,
  type LocalMoveFilesState,
  type LocalReadFileState,
  type LocalReadFilesState,
  type LocalRenameFileState,
  LocalSystemIdentifier,
  type RunCommandState,
} from '../types';

const LocalSystemApiEnum = {
  editLocalFile: 'editLocalFile' as const,
  getCommandOutput: 'getCommandOutput' as const,
  globLocalFiles: 'globLocalFiles' as const,
  grepContent: 'grepContent' as const,
  killCommand: 'killCommand' as const,
  listLocalFiles: 'listLocalFiles' as const,
  moveLocalFiles: 'moveLocalFiles' as const,
  readLocalFile: 'readLocalFile' as const,
  readLocalFiles: 'readLocalFiles' as const,
  renameLocalFile: 'renameLocalFile' as const,
  runCommand: 'runCommand' as const,
  searchLocalFiles: 'searchLocalFiles' as const,
  writeLocalFile: 'writeLocalFile' as const,
};

/**
 * Local System Tool Executor
 *
 * Handles all local file system operations including file CRUD, shell commands, and search.
 */
class LocalSystemExecutor extends BaseExecutor<typeof LocalSystemApiEnum> {
  readonly identifier = LocalSystemIdentifier;
  protected readonly apiEnum = LocalSystemApiEnum;

  // ==================== File Operations ====================

  listLocalFiles = async (params: ListLocalFileParams): Promise<BuiltinToolResult> => {
    try {
      const result: LocalFileItem[] = await localFileService.listLocalFiles(params);

      const state: LocalFileListState = { listResults: result };

      return {
        content: JSON.stringify(result),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  readLocalFile = async (params: LocalReadFileParams): Promise<BuiltinToolResult> => {
    try {
      const result: LocalReadFileResult = await localFileService.readLocalFile(params);

      const state: LocalReadFileState = { fileContent: result };

      return {
        content: JSON.stringify(result),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  readLocalFiles = async (params: LocalReadFilesParams): Promise<BuiltinToolResult> => {
    try {
      const results: LocalReadFileResult[] = await localFileService.readLocalFiles(params);

      const state: LocalReadFilesState = { filesContent: results };

      return {
        content: JSON.stringify(results),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  searchLocalFiles = async (params: LocalSearchFilesParams): Promise<BuiltinToolResult> => {
    try {
      const result: LocalFileItem[] = await localFileService.searchLocalFiles(params);

      const state: LocalFileSearchState = { searchResults: result };

      return {
        content: JSON.stringify(result),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  moveLocalFiles = async (params: MoveLocalFilesParams): Promise<BuiltinToolResult> => {
    try {
      const results: LocalMoveFilesResultItem[] = await localFileService.moveLocalFiles(params);

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
        message = `Failed to move all ${results.length} item(s).`;
      }

      const state: LocalMoveFilesState = {
        results,
        successCount,
        totalCount: results.length,
      };

      return {
        content: JSON.stringify({ message, results }),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  renameLocalFile = async (params: RenameLocalFileParams): Promise<BuiltinToolResult> => {
    try {
      const result: RenameLocalFileResult = await localFileService.renameLocalFile(params);

      if (!result.success) {
        const state: LocalRenameFileState = {
          error: result.error,
          newPath: '',
          oldPath: params.path,
          success: false,
        };

        return {
          content: JSON.stringify({ message: result.error, success: false }),
          state,
          success: false,
        };
      }

      const state: LocalRenameFileState = {
        newPath: result.newPath!,
        oldPath: params.path,
        success: true,
      };

      return {
        content: JSON.stringify({
          message: `Successfully renamed file ${params.path} to ${params.newName}.`,
          success: true,
        }),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  writeLocalFile = async (params: WriteLocalFileParams): Promise<BuiltinToolResult> => {
    try {
      const result = await localFileService.writeFile(params);

      if (!result.success) {
        return {
          content: JSON.stringify({
            message: result.error || 'Failed to write file',
            success: false,
          }),
          error: { message: result.error || 'Failed to write file', type: 'PluginServerError' },
          success: false,
        };
      }

      return {
        content: JSON.stringify({
          message: `Successfully wrote file ${params.path}`,
          success: true,
        }),
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  editLocalFile = async (params: EditLocalFileParams): Promise<BuiltinToolResult> => {
    try {
      const result: EditLocalFileResult = await localFileService.editLocalFile(params);

      if (!result.success) {
        return {
          content: `Edit failed: ${result.error}`,
          success: false,
        };
      }

      const statsText =
        result.linesAdded || result.linesDeleted
          ? ` (+${result.linesAdded || 0} -${result.linesDeleted || 0})`
          : '';
      const message = `Successfully replaced ${result.replacements} occurrence(s) in ${params.file_path}${statsText}`;

      const state: EditLocalFileState = {
        diffText: result.diffText,
        linesAdded: result.linesAdded,
        linesDeleted: result.linesDeleted,
        replacements: result.replacements,
      };

      return {
        content: message,
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  // ==================== Shell Commands ====================

  runCommand = async (params: RunCommandParams): Promise<BuiltinToolResult> => {
    try {
      const result: RunCommandResult = await localFileService.runCommand(params);

      let message: string;

      if (result.success) {
        if (result.shell_id) {
          message = `Command started in background with shell_id: ${result.shell_id}`;
        } else {
          message = `Command completed successfully.`;
        }
      } else {
        message = `Command failed: ${result.error}`;
      }

      const state: RunCommandState = { message, result };

      return {
        content: JSON.stringify(result),
        state,
        success: result.success,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  getCommandOutput = async (params: GetCommandOutputParams): Promise<BuiltinToolResult> => {
    try {
      const result: GetCommandOutputResult = await localFileService.getCommandOutput(params);

      const message = result.success
        ? `Output retrieved. Running: ${result.running}`
        : `Failed: ${result.error}`;

      const state: GetCommandOutputState = { message, result };

      return {
        content: JSON.stringify(result),
        state,
        success: result.success,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  killCommand = async (params: KillCommandParams): Promise<BuiltinToolResult> => {
    try {
      const result: KillCommandResult = await localFileService.killCommand(params);

      const message = result.success
        ? `Successfully killed shell: ${params.shell_id}`
        : `Failed to kill shell: ${result.error}`;

      const state: KillCommandState = { message, result };

      return {
        content: JSON.stringify(result),
        state,
        success: result.success,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  // ==================== Search & Find ====================

  grepContent = async (params: GrepContentParams): Promise<BuiltinToolResult> => {
    try {
      const result: GrepContentResult = await localFileService.grepContent(params);

      const message = result.success
        ? `Found ${result.total_matches} matches in ${result.matches.length} locations`
        : 'Search failed';

      const state: GrepContentState = { message, result };

      return {
        content: JSON.stringify(result),
        state,
        success: result.success,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  globLocalFiles = async (params: GlobFilesParams): Promise<BuiltinToolResult> => {
    try {
      const result: GlobFilesResult = await localFileService.globFiles(params);

      const message = result.success ? `Found ${result.total_files} files` : 'Glob search failed';

      const state: GlobFilesState = { message, result };

      return {
        content: JSON.stringify(result),
        state,
        success: result.success,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };
}

// Export the executor instance for registration
export const localSystemExecutor = new LocalSystemExecutor();
