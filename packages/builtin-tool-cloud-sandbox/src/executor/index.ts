import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { cloudSandboxService } from '@/services/cloudSandbox';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { CloudSandboxExecutionRuntime } from '../ExecutionRuntime';
import { CloudSandboxIdentifier } from '../manifest';
import type {
  EditLocalFileParams,
  ExecuteCodeParams,
  ExportFileParams,
  GetCommandOutputParams,
  GlobLocalFilesParams,
  GrepContentParams,
  ISandboxService,
  KillCommandParams,
  ListLocalFilesParams,
  MoveLocalFilesParams,
  ReadLocalFileParams,
  RenameLocalFileParams,
  RunCommandParams,
  SandboxCallToolResult,
  SandboxExportFileResult,
  SearchLocalFilesParams,
  WriteLocalFileParams,
} from '../types';
import { CloudSandboxApiName } from '../types';

/**
 * Client-side Sandbox Service
 * Wraps codeInterpreterService with bound context (topicId, userId)
 */
class ClientSandboxService implements ISandboxService {
  private topicId: string;
  private userId: string;

  constructor(topicId: string) {
    this.topicId = topicId;
    // Get userId from user store - client-side auth
    const userId = userProfileSelectors.userId(useUserStore.getState());
    if (!userId) {
      throw new Error('userId must be provided');
    }
    this.userId = userId;
  }

  async callTool(toolName: string, params: Record<string, any>): Promise<SandboxCallToolResult> {
    return cloudSandboxService.callTool(toolName, params, {
      topicId: this.topicId,
      userId: this.userId,
    });
  }

  async exportAndUploadFile(path: string, filename: string): Promise<SandboxExportFileResult> {
    return cloudSandboxService.exportAndUploadFile(path, filename, this.topicId);
  }
}

/**
 * Cloud Sandbox Client Executor
 *
 * This executor handles Cloud Sandbox tool calls on the client side.
 * It creates a CloudSandboxExecutionRuntime with a ClientSandboxService
 * that has topicId bound at construction time.
 */
class CloudSandboxExecutor extends BaseExecutor<typeof CloudSandboxApiName> {
  readonly identifier = CloudSandboxIdentifier;
  protected readonly apiEnum = CloudSandboxApiName;

  /**
   * Get or create a runtime for the given context
   */
  private getRuntime(ctx: BuiltinToolContext): CloudSandboxExecutionRuntime {
    const topicId = ctx.topicId;

    if (!topicId) {
      throw new Error('Can not init runtime with empty topicId');
    }

    const service = new ClientSandboxService(topicId);
    return new CloudSandboxExecutionRuntime(service);
  }

  // ==================== File Operations ====================

  listLocalFiles = async (
    params: ListLocalFilesParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.listLocalFiles(params);
    return this.toBuiltinResult(result);
  };

  readLocalFile = async (
    params: ReadLocalFileParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.readLocalFile(params);
    return this.toBuiltinResult(result);
  };

  writeLocalFile = async (
    params: WriteLocalFileParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.writeLocalFile(params);
    return this.toBuiltinResult(result);
  };

  editLocalFile = async (
    params: EditLocalFileParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.editLocalFile(params);
    return this.toBuiltinResult(result);
  };

  searchLocalFiles = async (
    params: SearchLocalFilesParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.searchLocalFiles(params);
    return this.toBuiltinResult(result);
  };

  moveLocalFiles = async (
    params: MoveLocalFilesParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.moveLocalFiles(params);
    return this.toBuiltinResult(result);
  };

  renameLocalFile = async (
    params: RenameLocalFileParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.renameLocalFile(params);
    return this.toBuiltinResult(result);
  };

  // ==================== Code Execution ====================

  executeCode = async (
    params: ExecuteCodeParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.executeCode(params);
    return this.toBuiltinResult(result);
  };

  // ==================== Shell Commands ====================

  runCommand = async (
    params: RunCommandParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.runCommand(params);
    return this.toBuiltinResult(result);
  };

  getCommandOutput = async (
    params: GetCommandOutputParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.getCommandOutput(params);
    return this.toBuiltinResult(result);
  };

  killCommand = async (
    params: KillCommandParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.killCommand(params);
    return this.toBuiltinResult(result);
  };

  // ==================== Search & Find ====================

  grepContent = async (
    params: GrepContentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.grepContent(params);
    return this.toBuiltinResult(result);
  };

  globLocalFiles = async (
    params: GlobLocalFilesParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.globLocalFiles(params);
    return this.toBuiltinResult(result);
  };

  // ==================== Export Operations ====================

  exportFile = async (
    params: ExportFileParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const runtime = this.getRuntime(ctx);
    const result = await runtime.exportFile(params);
    return this.toBuiltinResult(result);
  };

  // ==================== Helper Methods ====================

  /**
   * Convert BuiltinServerRuntimeOutput to BuiltinToolResult
   */
  private toBuiltinResult(output: {
    content: string;
    error?: any;
    state?: any;
    success: boolean;
  }): BuiltinToolResult {
    if (!output.success) {
      return {
        content: output.content,
        error: {
          body: output.error,
          message: output.content || 'Unknown error',
          type: 'PluginServerError',
        },
        state: output.state,
        success: false,
      };
    }

    return {
      content: output.content,
      state: output.state,
      success: true,
    };
  }
}

// Export the executor instance for registration
export const cloudSandboxExecutor = new CloudSandboxExecutor();
