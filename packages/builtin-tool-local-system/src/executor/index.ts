import type {
  EditLocalFileParams,
  GetCommandOutputParams,
  GlobFilesParams,
  GrepContentParams,
  KillCommandParams,
  ListLocalFileParams,
  LocalReadFileParams,
  LocalReadFilesParams,
  LocalSearchFilesParams,
  MoveLocalFilesParams,
  RenameLocalFileParams,
  RunCommandParams,
  WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import type { BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { localFileService } from '@/services/electron/localFileService';

import { LocalSystemExecutionRuntime } from '../ExecutionRuntime';
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
 * Delegates standard computer operations to LocalSystemExecutionRuntime (extends ComputerRuntime).
 * Handles scope resolution for paths before delegating.
 */
class LocalSystemExecutor extends BaseExecutor<typeof LocalSystemApiEnum> {
  readonly identifier = LocalSystemIdentifier;
  protected readonly apiEnum = LocalSystemApiEnum;

  private runtime = new LocalSystemExecutionRuntime(localFileService);

  /**
   * Convert BuiltinServerRuntimeOutput to BuiltinToolResult
   */
  private toResult(output: {
    content: string;
    error?: any;
    state?: any;
    success: boolean;
  }): BuiltinToolResult {
    if (!output.success) {
      return {
        content: output.content,
        error: output.error
          ? { body: output.error, message: output.content, type: 'PluginServerError' }
          : undefined,
        success: false,
      };
    }
    return { content: output.content, state: output.state, success: true };
  }

  // ==================== File Operations ====================

  listLocalFiles = async (params: ListLocalFileParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.listFiles({
        directoryPath: params.path,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  readLocalFile = async (params: LocalReadFileParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.readFile({
        endLine: params.loc?.[1],
        path: params.path,
        startLine: params.loc?.[0],
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  readLocalFiles = async (params: LocalReadFilesParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.readFiles(params);
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  searchLocalFiles = async (params: LocalSearchFilesParams): Promise<BuiltinToolResult> => {
    try {
      const resolvedParams = resolveArgsWithScope(params, 'directory');
      const result = await this.runtime.searchFiles({
        directory: resolvedParams.directory || '',
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  moveLocalFiles = async (params: MoveLocalFilesParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.moveFiles({
        operations: params.items.map((item) => ({
          destination: item.newPath,
          source: item.oldPath,
        })),
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  renameLocalFile = async (params: RenameLocalFileParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.renameFile({
        newName: params.newName,
        oldPath: params.path,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  writeLocalFile = async (params: WriteLocalFileParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.writeFile(params);
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  editLocalFile = async (params: EditLocalFileParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.editFile({
        all: params.replace_all,
        path: params.file_path,
        replace: params.new_string,
        search: params.old_string,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  // ==================== Shell Commands ====================

  runCommand = async (params: RunCommandParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.runCommand(params);
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  getCommandOutput = async (params: GetCommandOutputParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.getCommandOutput({
        commandId: params.shell_id,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  killCommand = async (params: KillCommandParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.killCommand({
        commandId: params.shell_id,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  // ==================== Search & Find ====================

  grepContent = async (params: GrepContentParams): Promise<BuiltinToolResult> => {
    try {
      const resolvedParams = resolveArgsWithScope(params, 'path');
      const result = await this.runtime.grepContent({
        directory: resolvedParams.path || '',
        pattern: resolvedParams.pattern,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  globLocalFiles = async (params: GlobFilesParams): Promise<BuiltinToolResult> => {
    try {
      const resolvedParams = resolveArgsWithScope(params, 'pattern');
      const result = await this.runtime.globFiles({
        pattern: resolvedParams.pattern,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  // ==================== Helpers ====================

  private errorResult(error: unknown): BuiltinToolResult {
    return {
      content: (error as Error).message,
      error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
      success: false,
    };
  }
}

// Export the executor instance for registration
export const localSystemExecutor = new LocalSystemExecutor();
