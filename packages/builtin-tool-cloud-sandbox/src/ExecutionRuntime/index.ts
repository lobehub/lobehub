import { formatSandboxRecreation } from '@lobechat/prompts/fileSystem';
import { ComputerRuntime } from '@lobechat/tool-runtime';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  AnalyzeStorageParams,
  DeleteFilesParams,
  ExecuteCodeParams,
  ExecuteCodeState,
  ExportFileParams,
  ExportFileState,
  ISandboxService,
  SandboxCallToolResult,
} from '../types';

const stringify = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value ?? null);

/**
 * Cloud Sandbox Execution Runtime
 *
 * Extends ComputerRuntime for standard computer operations (files, shell, search).
 * Adds cloud-specific capabilities: code execution and file export.
 *
 * Dependency Injection:
 * - Client: Inject codeInterpreterService (uses tRPC client)
 * - Server: Inject configured sandbox provider (Market, Onlyboxes, etc.)
 */
export class CloudSandboxExecutionRuntime extends ComputerRuntime {
  private sandboxService: ISandboxService;

  constructor(sandboxService: ISandboxService) {
    super();
    this.sandboxService = sandboxService;
  }

  protected async callService(
    toolName: string,
    params: Record<string, any>,
  ): Promise<SandboxCallToolResult> {
    return this.sandboxService.callTool(toolName, params);
  }

  // ==================== Cloud-Specific: Code Execution ====================

  async executeCode(args: ExecuteCodeParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const language = args.language || 'python';
      const result = await this.callService('executeCode', {
        code: args.code,
        language,
      });

      const state: ExecuteCodeState = {
        ...(result.sessionExpiredAndRecreated && { sessionExpiredAndRecreated: true }),
        error: result.result?.error,
        exitCode: result.result?.exitCode,
        language,
        output: result.result?.output,
        stderr: result.result?.stderr,
        success: result.success || false,
      };

      if (!result.success) {
        return {
          content: formatSandboxRecreation(
            result.error?.message || 'Failed to execute code in sandbox',
            result.sessionExpiredAndRecreated,
          ),
          // Execution may have completed before its response failed. Preserve
          // diagnostics without automatically replaying arbitrary code.
          error: {
            ...result.error,
            kind: 'stop',
            message: result.error?.message || 'Failed to execute code in sandbox',
          },
          state,
          success: false,
        };
      }

      return {
        content: formatSandboxRecreation(
          JSON.stringify(result.result),
          result.sessionExpiredAndRecreated,
        ),
        state,
        success: true,
      };
    } catch (error) {
      console.error('executeCode error', error);
      return this.handleError(error);
    }
  }

  // ==================== Cloud-Specific: Drive Space ====================

  /**
   * What takes up the persistent drive, by category, with the largest items.
   * Answered by the storage service off the volume — no command runs — so it
   * works on a drive over its quota, where every shell command is refused.
   */
  async analyzeStorage(args: AnalyzeStorageParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      // Capped so the listing stays a reasonable share of the model's context.
      const top = typeof args.top === 'number' ? Math.min(Math.max(1, args.top), 50) : undefined;
      const result = await this.callService('analyzeStorage', { top });
      if (!result.success) return this.serviceFailure(result, 'Failed to analyze the drive', true);

      return { content: stringify(result.result), state: result.result, success: true };
    } catch (error) {
      return this.handleError(error, true);
    }
  }

  /**
   * Delete files or folders on the persistent drive for good, past the quota.
   * Whether the user is asked first is the manifest's dynamic audit; the
   * storage service enforces `regenerableOnly` on the volume itself.
   */
  async deleteFiles(args: DeleteFilesParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService('deleteFiles', {
        paths: args.paths,
        regenerableOnly: args.regenerableOnly === true,
      });
      if (!result.success) return this.serviceFailure(result, 'Failed to delete the files');

      return { content: stringify(result.result), state: result.result, success: true };
    } catch (error) {
      return this.handleError(error);
    }
  }

  private serviceFailure(
    result: SandboxCallToolResult,
    fallback: string,
    retrySafe = false,
  ): BuiltinServerRuntimeOutput {
    const message = result.error?.message || fallback;
    return {
      content: message,
      error: { ...result.error, kind: retrySafe ? undefined : 'stop', message },
      success: false,
    };
  }

  // ==================== Cloud-Specific: File Export ====================

  /**
   * Export a file from the sandbox to cloud storage
   */
  async exportFile(args: ExportFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const filename = args.path.split('/').pop() || 'exported_file';

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
          // Upload or registration may already have succeeded before the error.
          error: {
            ...result.error,
            kind: 'stop',
            message: result.error?.message || 'Failed to export file from sandbox',
          },
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
}
