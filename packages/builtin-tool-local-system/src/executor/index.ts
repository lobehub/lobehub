/* eslint-disable import-x/consistent-type-specifier-style */
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
import {
  formatCommandOutput,
  formatCommandResult,
  formatEditResult,
  formatFileContent,
  formatFileList,
  formatFileSearchResults,
  formatGlobResults,
  formatGrepResults,
  formatKillResult,
  formatMoveResults,
  formatMultipleFiles,
  formatRenameResult,
  formatWriteResult,
} from '@lobechat/prompts';
import { type BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { localFileService } from '@/services/electron/localFileService';

import type {
  EditLocalFileState,
  GetCommandOutputState,
  GlobFilesState,
  GrepContentState,
  KillCommandState,
  LocalFileListState,
  LocalFileSearchState,
  LocalMoveFilesState,
  LocalReadFilesState,
  LocalReadFileState,
  LocalRenameFileState,
  RunCommandState,
} from '../types';
import { LocalSystemIdentifier } from '../types';
import { resolveArgsWithScope } from '../utils/path';

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
      const result = await localFileService.listLocalFiles(params);

      const state: LocalFileListState = {
        listResults: result.files,
        totalCount: result.totalCount,
      };

      const content = formatFileList({
        directory: params.path,
        files: result.files,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        totalCount: result.totalCount,
      });

      return {
        content,
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

      const content = formatFileContent({
        content: result.content,
        lineRange: params.loc,
        path: params.path,
      });

      return {
        content,
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

      const content = formatMultipleFiles(results);

      return {
        content,
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
      const resolvedParams = resolveArgsWithScope(params, 'directory');

      const result: LocalFileItem[] = await localFileService.searchLocalFiles(resolvedParams);

      // Extract engine from first result (all results use same engine)
      const engine = result[0]?.engine;
      const state: LocalFileSearchState = {
        engine,
        resolvedPath: resolvedParams.directory,
        searchResults: result,
      };

      const content = formatFileSearchResults(result);

      return {
        content,
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

      const successCount = results.filter((r) => r.success).length;

      const content = formatMoveResults(results);

      const state: LocalMoveFilesState = {
        results,
        successCount,
        totalCount: results.length,
      };

      return {
        content,
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
          content: formatRenameResult({
            error: result.error,
            newName: params.newName,
            oldPath: params.path,
            success: false,
          }),
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
        content: formatRenameResult({
          newName: params.newName,
          oldPath: params.path,
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
          content: formatWriteResult({
            error: result.error,
            path: params.path,
            success: false,
          }),
          error: { message: result.error || 'Failed to write file', type: 'PluginServerError' },
          success: false,
        };
      }

      return {
        content: formatWriteResult({
          path: params.path,
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

      const content = formatEditResult({
        filePath: params.file_path,
        linesAdded: result.linesAdded,
        linesDeleted: result.linesDeleted,
        replacements: result.replacements,
      });

      const state: EditLocalFileState = {
        diffText: result.diffText,
        linesAdded: result.linesAdded,
        linesDeleted: result.linesDeleted,
        replacements: result.replacements,
      };

      return {
        content,
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

      const content = formatCommandResult({
        error: result.error,
        exitCode: result.exit_code,
        shellId: result.shell_id,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.success,
      });

      const state: RunCommandState = { message: content.split('\n\n')[0], result };

      return {
        content,
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

      const content = formatCommandOutput({
        error: result.error,
        output: result.output,
        running: result.running,
        success: result.success,
      });

      const state: GetCommandOutputState = { message: content.split('\n\n')[0], result };

      return {
        content,
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

      const content = formatKillResult({
        error: result.error,
        shellId: params.shell_id,
        success: result.success,
      });

      const state: KillCommandState = { message: content, result };

      return {
        content,
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
      const resolvedParams = resolveArgsWithScope(params, 'path');

      const result: GrepContentResult = await localFileService.grepContent(resolvedParams);

      const content = result.success
        ? formatGrepResults({
            matches: result.matches,
            totalMatches: result.total_matches,
          })
        : `Search failed: ${result.error || 'Unknown error'}`;

      const state: GrepContentState = {
        message: content.split('\n')[0],
        resolvedPath: resolvedParams.path,
        result,
      };

      return {
        content,
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
      const resolvedParams = resolveArgsWithScope(params, 'pattern');

      const result: GlobFilesResult = await localFileService.globFiles(resolvedParams);

      const content = result.success
        ? formatGlobResults({
            files: result.files,
            totalFiles: result.total_files,
          })
        : `Glob search failed: ${result.error || 'Unknown error'}`;

      const state: GlobFilesState = {
        message: content.split('\n')[0],
        resolvedPath: resolvedParams.pattern,
        result,
      };

      return {
        content,
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
