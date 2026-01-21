import {
  formatEditResult,
  formatFileContent,
  formatFileList,
  formatFileSearchResults,
  formatGlobResults,
  formatMoveResults,
  formatRenameResult,
  formatWriteResult,
} from '@lobechat/prompts';
import { type BuiltinServerRuntimeOutput } from '@lobechat/types';

import {
  type EditLocalFileParams,
  type EditLocalFileState,
  type ExecuteCodeParams,
  type ExecuteCodeState,
  type ExportFileParams,
  type ExportFileState,
  type GetCommandOutputParams,
  type GetCommandOutputState,
  type GlobFilesState,
  type GlobLocalFilesParams,
  type GrepContentParams,
  type GrepContentState,
  type ISandboxService,
  type KillCommandParams,
  type KillCommandState,
  type ListLocalFilesParams,
  type ListLocalFilesState,
  type MoveLocalFilesParams,
  type MoveLocalFilesState,
  type ReadLocalFileParams,
  type ReadLocalFileState,
  type RenameLocalFileParams,
  type RenameLocalFileState,
  type RunCommandParams,
  type RunCommandState,
  type SearchLocalFilesParams,
  type SearchLocalFilesState,
  type WriteLocalFileParams,
  type WriteLocalFileState,
} from '../types';

/**
 * Cloud Sandbox Execution Runtime
 *
 * This runtime executes tools via the injected ISandboxService.
 * The service handles context (topicId, userId) internally - Runtime doesn't need to know about it.
 *
 * Dependency Injection:
 * - Client: Inject codeInterpreterService (uses tRPC client)
 * - Server: Inject ServerSandboxService (uses MarketSDK directly)
 */
export class CloudSandboxExecutionRuntime {
  private sandboxService: ISandboxService;

  constructor(sandboxService: ISandboxService) {
    this.sandboxService = sandboxService;
  }

  // ==================== File Operations ====================

  async listLocalFiles(args: ListLocalFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('listLocalFiles', args);

      const files = result.result?.files || [];
      const state: ListLocalFilesState = { files };

      const content = formatFileList(
        files.map((f: { isDirectory: boolean; name: string }) => ({
          isDirectory: f.isDirectory,
          name: f.name,
        })),
        args.directoryPath,
      );

      return {
        content,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async readLocalFile(args: ReadLocalFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('readLocalFile', args);

      const state: ReadLocalFileState = {
        content: result.result?.content || '',
        endLine: args.endLine,
        path: args.path,
        startLine: args.startLine,
        totalLines: result.result?.totalLines,
      };

      const lineRange: [number, number] | undefined =
        args.startLine !== undefined && args.endLine !== undefined
          ? [args.startLine, args.endLine]
          : undefined;

      const content = formatFileContent({
        content: result.result?.content || '',
        lineRange,
        path: args.path,
      });

      return {
        content,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async writeLocalFile(args: WriteLocalFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('writeLocalFile', args);

      const state: WriteLocalFileState = {
        bytesWritten: result.result?.bytesWritten,
        path: args.path,
        success: result.success,
      };

      const content = formatWriteResult({
        path: args.path,
        success: true,
      });

      return {
        content,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async editLocalFile(args: EditLocalFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('editLocalFile', args);

      const state: EditLocalFileState = {
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

      return {
        content,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async searchLocalFiles(args: SearchLocalFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('searchLocalFiles', args);

      const results = result.result?.results || [];
      const state: SearchLocalFilesState = {
        results,
        totalCount: result.result?.totalCount || 0,
      };

      const content = formatFileSearchResults(
        results.map((r: { path: string }) => ({ path: r.path })),
      );

      return {
        content,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async moveLocalFiles(args: MoveLocalFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('moveLocalFiles', args);

      const results = result.result?.results || [];
      const state: MoveLocalFilesState = {
        results,
        successCount: result.result?.successCount || 0,
        totalCount: args.operations.length,
      };

      const content = formatMoveResults(results);

      return {
        content,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async renameLocalFile(args: RenameLocalFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('renameLocalFile', args);

      const state: RenameLocalFileState = {
        error: result.result?.error,
        newPath: result.result?.newPath || '',
        oldPath: args.oldPath,
        success: result.success,
      };

      const content = formatRenameResult({
        error: result.result?.error,
        newName: args.newName,
        oldPath: args.oldPath,
        success: result.success,
      });

      return {
        content,
        state,
        success: result.success,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Code Execution ====================

  async executeCode(args: ExecuteCodeParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const language = args.language || 'python';
      const result = await this.callTool('executeCode', {
        code: args.code,
        language,
      });

      const state: ExecuteCodeState = {
        error: result.result?.error,
        exitCode: result.result?.exitCode,
        language,
        output: result.result?.output,
        stderr: result.result?.stderr,
        success: result.success,
      };

      return {
        content: JSON.stringify(result.result),
        state,
        success: result.success,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Shell Commands ====================

  async runCommand(args: RunCommandParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('runCommand', args);

      const state: RunCommandState = {
        commandId: result.result?.commandId,
        error: result.result?.error,
        exitCode: result.result?.exitCode,
        isBackground: args.background || false,
        output: result.result?.output,
        stderr: result.result?.stderr,
        success: result.success,
      };

      return {
        content: JSON.stringify(result.result),
        state,
        success: result.success,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getCommandOutput(args: GetCommandOutputParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('getCommandOutput', args);

      const state: GetCommandOutputState = {
        error: result.result?.error,
        newOutput: result.result?.newOutput,
        running: result.result?.running ?? false,
        success: result.success,
      };

      return {
        content: JSON.stringify(result.result),
        state,
        success: result.success,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async killCommand(args: KillCommandParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('killCommand', args);

      const state: KillCommandState = {
        commandId: args.commandId,
        error: result.result?.error,
        success: result.success,
      };

      return {
        content: JSON.stringify({
          message: `Successfully killed command: ${args.commandId}`,
          success: true,
        }),
        state,
        success: result.success,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Search & Find ====================

  async grepContent(args: GrepContentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('grepContent', args);

      const state: GrepContentState = {
        matches: result.result?.matches || [],
        pattern: args.pattern,
        totalMatches: result.result?.totalMatches || 0,
      };

      return {
        content: JSON.stringify(result.result),
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async globLocalFiles(args: GlobLocalFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callTool('globLocalFiles', args);

      const files = result.result?.files || [];
      const totalCount = result.result?.totalCount || 0;

      const state: GlobFilesState = {
        files,
        pattern: args.pattern,
        totalCount,
      };

      const content = formatGlobResults({
        files,
        totalFiles: totalCount,
      });

      return {
        content,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Export Operations ====================

  /**
   * Export a file from the sandbox to cloud storage
   * Uses a single call that handles:
   * 1. Generate pre-signed upload URL
   * 2. Call sandbox to upload file
   * 3. Create persistent file record
   * 4. Return permanent /f/:id URL
   */
  async exportFile(args: ExportFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      // Extract filename from path
      const filename = args.path.split('/').pop() || 'exported_file';

      // Single call that handles everything: upload URL generation, sandbox upload, and file record creation
      const result = await this.sandboxService.exportAndUploadFile(args.path, filename);

      const state: ExportFileState = {
        downloadUrl: result.success && result.url ? result.url : '',
        fileId: result.fileId,
        filename: result.filename,
        mimeType: result.mimeType,
        path: args.path,
        size: result.size,
        success: result.success,
      };

      if (!result.success) {
        return {
          content: JSON.stringify({
            error: result.error?.message || 'Failed to export file from sandbox',
            filename,
            success: false,
          }),
          state,
          success: false,
        };
      }

      return {
        content: `File exported successfully.\n\nFilename: ${filename}\nDownload URL: ${result.url}`,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Call a tool via the injected sandbox service
   */
  private async callTool(
    toolName: string,
    params: Record<string, any>,
  ): Promise<{ result: any; sessionExpiredAndRecreated?: boolean; success: boolean }> {
    const result = await this.sandboxService.callTool(toolName, params);

    if (!result.success) {
      throw new Error(result.error?.message || `Cloud Sandbox tool ${toolName} failed`);
    }

    return result;
  }

  private handleError(error: unknown): BuiltinServerRuntimeOutput {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: errorMessage,
      error,
      success: false,
    };
  }
}
