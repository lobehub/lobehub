import { ComputerRuntime } from '@lobechat/tool-runtime';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  ExecuteCodeParams,
  ExecuteCodeState,
  ExportFileParams,
  ExportFileState,
  ISandboxService,
  SandboxCallToolResult,
} from '../types';

/**
 * Cloud Sandbox Execution Runtime
 *
 * Extends ComputerRuntime for standard computer operations (files, shell, search).
 * Adds cloud-specific capabilities: code execution and file export.
 *
 * Dependency Injection:
 * - Client: Inject codeInterpreterService (uses tRPC client)
 * - Server: Inject ServerSandboxService (uses MarketSDK directly)
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
        error: result.result?.error,
        exitCode: result.result?.exitCode,
        language,
        output: result.result?.output,
        stderr: result.result?.stderr,
        success: result.success || false,
      };

      if (!result.success) {
        return {
          content: result.error?.message || JSON.stringify(result.error),
          state,
          success: true,
        };
      }

      return {
        content: JSON.stringify(result.result),
        state,
        success: true,
      };
    } catch (error) {
      console.error('executeCode error', error);
      return this.handleError(error);
    }
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
          state,
          success: true,
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
