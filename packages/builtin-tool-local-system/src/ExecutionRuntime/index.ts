import {
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
import { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
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
} from '../types';

interface LocalFileService {
  editLocalFile: (params: EditLocalFileParams) => Promise<EditLocalFileResult>;
  getCommandOutput: (params: GetCommandOutputParams) => Promise<GetCommandOutputResult>;
  globFiles: (params: GlobFilesParams) => Promise<GlobFilesResult>;
  grepContent: (params: GrepContentParams) => Promise<GrepContentResult>;
  killCommand: (params: KillCommandParams) => Promise<KillCommandResult>;
  listLocalFiles: (params: ListLocalFileParams) => Promise<LocalFileItem[]>;
  moveLocalFiles: (params: MoveLocalFilesParams) => Promise<LocalMoveFilesResultItem[]>;
  readLocalFile: (params: LocalReadFileParams) => Promise<LocalReadFileResult>;
  readLocalFiles: (params: LocalReadFilesParams) => Promise<LocalReadFileResult[]>;
  renameLocalFile: (params: RenameLocalFileParams) => Promise<RenameLocalFileResult>;
  runCommand: (params: RunCommandParams) => Promise<RunCommandResult>;
  searchLocalFiles: (params: LocalSearchFilesParams) => Promise<LocalFileItem[]>;
  writeFile: (params: WriteLocalFileParams) => Promise<{ error?: string; success: boolean }>;
}

export class LocalSystemExecutionRuntime {
  private localFileService: LocalFileService;

  constructor(localFileService: LocalFileService) {
    this.localFileService = localFileService;
  }

  // ==================== File Operations ====================

  async listLocalFiles(args: ListLocalFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: LocalFileItem[] = await this.localFileService.listLocalFiles(args);

      const state: LocalFileListState = { listResults: result };

      return {
        content: JSON.stringify(result),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error,
        success: false,
      };
    }
  }

  async readLocalFile(args: LocalReadFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: LocalReadFileResult = await this.localFileService.readLocalFile(args);

      const state: LocalReadFileState = { fileContent: result };

      return {
        content: JSON.stringify(result),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error,
        success: false,
      };
    }
  }

  async readLocalFiles(args: LocalReadFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const results: LocalReadFileResult[] = await this.localFileService.readLocalFiles(args);

      const state: LocalReadFilesState = { filesContent: results };

      return {
        content: JSON.stringify(results),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error,
        success: false,
      };
    }
  }

  async searchLocalFiles(args: LocalSearchFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: LocalFileItem[] = await this.localFileService.searchLocalFiles(args);

      const state: LocalFileSearchState = { searchResults: result };

      return {
        content: JSON.stringify(result),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error,
        success: false,
      };
    }
  }

  async moveLocalFiles(args: MoveLocalFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const results: LocalMoveFilesResultItem[] = await this.localFileService.moveLocalFiles(args);

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
        error,
        success: false,
      };
    }
  }

  async renameLocalFile(args: RenameLocalFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: RenameLocalFileResult = await this.localFileService.renameLocalFile(args);

      if (!result.success) {
        const state: LocalRenameFileState = {
          error: result.error,
          newPath: '',
          oldPath: args.path,
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
        oldPath: args.path,
        success: true,
      };

      return {
        content: JSON.stringify({
          message: `Successfully renamed file ${args.path} to ${args.newName}.`,
          success: true,
        }),
        state,
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error,
        success: false,
      };
    }
  }

  async writeLocalFile(args: WriteLocalFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.localFileService.writeFile(args);

      if (!result.success) {
        return {
          content: JSON.stringify({
            message: result.error || '写入文件失败',
            success: false,
          }),
          error: result.error,
          success: false,
        };
      }

      return {
        content: JSON.stringify({
          message: `成功写入文件 ${args.path}`,
          success: true,
        }),
        success: true,
      };
    } catch (error) {
      return {
        content: (error as Error).message,
        error,
        success: false,
      };
    }
  }

  async editLocalFile(args: EditLocalFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: EditLocalFileResult = await this.localFileService.editLocalFile(args);

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
      const message = `Successfully replaced ${result.replacements} occurrence(s) in ${args.file_path}${statsText}`;

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
        error,
        success: false,
      };
    }
  }

  // ==================== Shell Commands ====================

  async runCommand(args: RunCommandParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: RunCommandResult = await this.localFileService.runCommand(args);

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
        error,
        success: false,
      };
    }
  }

  async getCommandOutput(args: GetCommandOutputParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: GetCommandOutputResult = await this.localFileService.getCommandOutput(args);

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
        error,
        success: false,
      };
    }
  }

  async killCommand(args: KillCommandParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: KillCommandResult = await this.localFileService.killCommand(args);

      const message = result.success
        ? `Successfully killed shell: ${args.shell_id}`
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
        error,
        success: false,
      };
    }
  }

  // ==================== Search & Find ====================

  async grepContent(args: GrepContentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: GrepContentResult = await this.localFileService.grepContent(args);

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
        error,
        success: false,
      };
    }
  }

  async globLocalFiles(args: GlobFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result: GlobFilesResult = await this.localFileService.globFiles(args);

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
        error,
        success: false,
      };
    }
  }
}
