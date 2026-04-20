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
  formatRenameResult,
  formatWriteResult,
} from '@lobechat/prompts';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  EditFileParams,
  EditFileState,
  GetCommandOutputParams,
  GetCommandOutputState,
  GlobFilesParams,
  GlobFilesState,
  GrepContentParams,
  GrepContentState,
  KillCommandParams,
  KillCommandState,
  ListFilesParams,
  ListFilesState,
  MoveFilesParams,
  MoveFilesState,
  ReadFileParams,
  ReadFileState,
  RenameFileParams,
  RenameFileState,
  RunCommandParams,
  RunCommandState,
  SearchFilesParams,
  SearchFilesState,
  ServiceResult,
  WriteFileParams,
  WriteFileState,
} from './types';

/**
 * ComputerRuntime — abstract base for computer operations (file system, shell, search).
 *
 * Subclasses implement `callService` to delegate to their specific backend
 * (Electron IPC, cloud sandbox API, etc.). The base class handles:
 * - Normalizing raw results into formatted content via `@lobechat/prompts`
 * - Building consistent state objects for UI rendering
 */
export abstract class ComputerRuntime {
  /**
   * Call the underlying service to execute a tool.
   * Each subclass maps this to its own transport (IPC, HTTP, tRPC, etc.).
   */
  protected abstract callService(
    toolName: string,
    params: Record<string, any>,
  ): Promise<ServiceResult>;

  // ==================== File Operations ====================

  async listFiles(args: ListFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('listLocalFiles', args);

      if (!result.success) {
        return this.errorOutput(result, { files: [], totalCount: 0 });
      }

      const files = result.result?.files || [];
      const totalCount = result.result?.totalCount;

      const state: ListFilesState = { files, totalCount };

      const content = formatFileList({
        directory: args.directoryPath,
        files: files.map((f: { isDirectory: boolean; name: string }) => ({
          isDirectory: f.isDirectory,
          name: f.name,
        })),
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
        totalCount,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async readFile(args: ReadFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('readLocalFile', args);

      if (!result.success) {
        return this.errorOutput(result, {
          content: '',
          endLine: args.endLine,
          path: args.path,
          startLine: args.startLine,
        });
      }

      const r = result.result || {};
      const fileContent = r.content || '';

      const state: ReadFileState = {
        charCount: r.charCount ?? fileContent.length,
        content: fileContent,
        endLine: args.endLine,
        fileType: r.fileType,
        filename: r.filename,
        loc: r.loc,
        path: args.path,
        startLine: args.startLine,
        totalCharCount: r.totalCharCount,
        totalLines: r.totalLineCount ?? r.totalLines,
      };

      const lineRange: [number, number] | undefined =
        args.startLine !== undefined && args.endLine !== undefined
          ? [args.startLine, args.endLine]
          : undefined;

      const content = formatFileContent({
        content: fileContent,
        lineRange,
        path: args.path,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async writeFile(args: WriteFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('writeLocalFile', args);

      if (!result.success) {
        return this.errorOutput(result, { path: args.path, success: false });
      }

      const state: WriteFileState = {
        bytesWritten: result.result?.bytesWritten,
        path: args.path,
        success: true,
      };

      const content = formatWriteResult({ path: args.path, success: true });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async editFile(args: EditFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('editLocalFile', args);

      if (!result.success) {
        return this.errorOutput(result, { path: args.path, replacements: 0 });
      }

      const state: EditFileState = {
        diffText: result.result?.diffText,
        linesAdded: result.result?.linesAdded,
        linesDeleted: result.result?.linesDeleted,
        path: args.path,
        replacements: result.result?.replacements || 0,
      };

      const content = formatEditResult({
        filePath: args.path,
        linesAdded: state.linesAdded,
        linesDeleted: state.linesDeleted,
        replacements: state.replacements,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async searchFiles(args: SearchFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('searchLocalFiles', args);

      if (!result.success) {
        return this.errorOutput(result, { results: [], totalCount: 0 });
      }

      const rawResults = result.result?.results || result.result;
      const results = Array.isArray(rawResults) ? rawResults : [];
      const state: SearchFilesState = {
        results,
        totalCount: result.result?.totalCount || results.length,
      };

      const content = formatFileSearchResults(
        results.map((r: { path: string }) => ({ path: r.path })),
      );

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async moveFiles(args: MoveFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('moveLocalFiles', args);

      if (!result.success) {
        return this.errorOutput(result, {
          results: [],
          successCount: 0,
          totalCount: args.operations.length,
        });
      }

      const rawResults = result.result?.results || result.result;
      const results = Array.isArray(rawResults) ? rawResults : [];
      const successCount =
        result.result?.successCount ??
        results.filter((r: { success: boolean }) => r.success).length;

      const state: MoveFilesState = {
        results,
        successCount,
        totalCount: args.operations.length,
      };

      const content = formatMoveResults(results);

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async renameFile(args: RenameFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('renameLocalFile', args);

      if (!result.success) {
        const errorMsg = result.error?.message || result.result?.error;
        return {
          content: formatRenameResult({
            error: errorMsg,
            newName: args.newName,
            oldPath: args.oldPath,
            success: false,
          }),
          state: {
            error: errorMsg,
            newPath: '',
            oldPath: args.oldPath,
            success: false,
          } satisfies RenameFileState,
          success: true,
        };
      }

      const state: RenameFileState = {
        error: result.result?.error,
        newPath: result.result?.newPath || '',
        oldPath: args.oldPath,
        success: true,
      };

      const content = formatRenameResult({
        error: result.result?.error,
        newName: args.newName,
        oldPath: args.oldPath,
        success: true,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Shell Commands ====================

  async runCommand(args: RunCommandParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('runCommand', args);

      if (!result.success) {
        return this.errorOutput(result, {
          error: result.error?.message,
          isBackground: args.background || false,
          success: false,
        });
      }

      const r = result.result || {};

      const state: RunCommandState = {
        commandId: r.commandId || r.shell_id,
        error: r.error,
        exitCode: r.exitCode ?? r.exit_code,
        isBackground: args.background || false,
        output: r.output,
        stderr: r.stderr,
        stdout: r.stdout,
        success: result.success,
      };

      const content = formatCommandResult({
        error: r.error,
        exitCode: r.exitCode ?? r.exit_code,
        shellId: r.commandId || r.shell_id,
        stderr: r.stderr,
        stdout: r.stdout || r.output,
        success: result.success,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getCommandOutput(args: GetCommandOutputParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('getCommandOutput', args);

      if (!result.success) {
        return this.errorOutput(result, {
          error: result.error?.message,
          running: false,
          success: false,
        });
      }

      const r = result.result || {};

      const state: GetCommandOutputState = {
        error: r.error,
        newOutput: r.newOutput || r.output,
        running: r.running ?? false,
        success: result.success,
      };

      const content = formatCommandOutput({
        error: r.error,
        output: r.newOutput || r.output,
        running: r.running ?? false,
        success: result.success,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async killCommand(args: KillCommandParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('killCommand', args);

      if (!result.success) {
        return this.errorOutput(result, {
          commandId: args.commandId,
          error: result.error?.message,
          success: false,
        });
      }

      const state: KillCommandState = {
        commandId: args.commandId,
        error: result.result?.error,
        success: result.success,
      };

      const content = formatKillResult({
        error: result.result?.error,
        shellId: args.commandId,
        success: result.success,
      });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Search & Find ====================

  async grepContent(args: GrepContentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('grepContent', args);

      if (!result.success) {
        return this.errorOutput(result, {
          matches: [],
          pattern: args.pattern,
          totalMatches: 0,
        });
      }

      const r = result.result || {};
      const matches = r.matches || [];
      const totalMatches = r.totalMatches ?? r.total_matches ?? 0;

      const state: GrepContentState = {
        matches,
        pattern: args.pattern,
        totalMatches,
      };

      const content = formatGrepResults({ matches, totalMatches });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async globFiles(args: GlobFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('globLocalFiles', args);

      if (!result.success) {
        return this.errorOutput(result, {
          files: [],
          pattern: args.pattern,
          totalCount: 0,
        });
      }

      const files = result.result?.files || [];
      const totalCount = result.result?.totalCount ?? result.result?.total_files ?? files.length;

      const state: GlobFilesState = {
        files,
        pattern: args.pattern,
        totalCount,
      };

      const content = formatGlobResults({ files, totalFiles: totalCount });

      return { content, state, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Helpers ====================

  protected handleError(error: unknown): BuiltinServerRuntimeOutput {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { content: errorMessage, error, success: false };
  }

  private errorOutput(result: ServiceResult, state: any): BuiltinServerRuntimeOutput {
    return {
      content: result.error?.message || JSON.stringify(result.error),
      state,
      success: true,
    };
  }
}
