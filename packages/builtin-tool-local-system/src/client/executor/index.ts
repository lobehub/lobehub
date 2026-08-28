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
  RunCommandParams,
  WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import { LocalSystemExecutionRuntime } from '@lobechat/tool-runtime';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { localFileService } from '@/services/electron/localFileService';

import { LocalSystemIdentifier } from '../../types';

const LocalSystemApiEnum = {
  editFile: 'editFile' as const,
  getCommandOutput: 'getCommandOutput' as const,
  globFiles: 'globFiles' as const,
  grepContent: 'grepContent' as const,
  killCommand: 'killCommand' as const,
  listFiles: 'listFiles' as const,
  moveFiles: 'moveFiles' as const,
  readFile: 'readFile' as const,
  readFiles: 'readFiles' as const,
  runCommand: 'runCommand' as const,
  searchFiles: 'searchFiles' as const,
  writeFile: 'writeFile' as const,
};

/**
 * Local System Tool Executor
 *
 * Thin adapter over `LocalSystemExecutionRuntime.executeToolCall`, which owns
 * legacy alias normalization, IPC field mapping, and working-directory
 * anchoring for every tool. The executor only contributes the two things the
 * runtime can't know:
 * - `ctx.workingDirectory` — the agent's effective working directory, sourced
 *   from the same place as the `{{workingDirectory}}` prompt placeholder, so
 *   what tools operate on matches what the prompt promises;
 * - the `BuiltinServerRuntimeOutput` → `BuiltinToolResult` conversion.
 */
class LocalSystemExecutor extends BaseExecutor<typeof LocalSystemApiEnum> {
  readonly identifier = LocalSystemIdentifier;
  protected readonly apiEnum = LocalSystemApiEnum;

  private runtime = new LocalSystemExecutionRuntime(localFileService);

  private execute = async (
    apiName: keyof typeof LocalSystemApiEnum,
    params: Record<string, any>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      // `trustArgsCwd` stays off: `params` came straight from the model, and
      // `ctx.workingDirectory` is undefined whenever the agent has none
      // configured — so an off-contract `cwd` must be dropped here rather than
      // mistaken for a server-injected one.
      const output = await this.runtime.executeToolCall(apiName, params, {
        workingDirectory: ctx?.workingDirectory,
      });
      // apiEnum and the runtime dispatch cover the same tool set, so a null
      // (unknown tool) here is a programming error, not a user-facing state.
      if (!output) return this.errorResult(new Error(`Unknown local-system API: ${apiName}`));
      return this.toResult(output);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  /**
   * Convert BuiltinServerRuntimeOutput to BuiltinToolResult.
   *
   * Single funnel for every executor return — keep it strict:
   * - never propagate an undefined `content` (would collapse downstream into
   *   `''` and leave the Debug "Response" pane blank while pluginState was
   *   still saved — see globFiles regression);
   * - always preserve `state` when the runtime produced one, regardless of
   *   `success`, so renderers can keep displaying partial outputs on failure.
   */
  private toResult(output: {
    content: string;
    error?: any;
    state?: any;
    success: boolean;
  }): BuiltinToolResult {
    const errorMessage =
      typeof output.error?.message === 'string' ? output.error.message : undefined;
    const safeContent =
      output.content || errorMessage || '[UNKNOWN_EXEC_ERROR] Tool execution failed';

    if (!output.success) {
      return {
        content: safeContent,
        error: output.error
          ? { body: output.error, message: errorMessage ?? safeContent, type: 'PluginServerError' }
          : undefined,
        state: output.state,
        success: false,
      };
    }
    return { content: safeContent, state: output.state, success: true };
  }

  // ==================== File Operations ====================

  listFiles = (params: ListLocalFileParams, ctx?: BuiltinToolContext) =>
    this.execute('listFiles', params, ctx);

  readFile = (params: LocalReadFileParams, ctx?: BuiltinToolContext) =>
    this.execute('readFile', params, ctx);

  readFiles = (params: LocalReadFilesParams, ctx?: BuiltinToolContext) =>
    this.execute('readFiles', params, ctx);

  searchFiles = (params: LocalSearchFilesParams, ctx?: BuiltinToolContext) =>
    this.execute('searchFiles', params, ctx);

  moveFiles = (params: MoveLocalFilesParams, ctx?: BuiltinToolContext) =>
    this.execute('moveFiles', params, ctx);

  writeFile = (params: WriteLocalFileParams, ctx?: BuiltinToolContext) =>
    this.execute('writeFile', params, ctx);

  editFile = (params: EditLocalFileParams, ctx?: BuiltinToolContext) =>
    this.execute('editFile', params, ctx);

  // ==================== Shell Commands ====================

  // The sandbox decision rides on the context, resolved by the caller from the
  // agent's config — never from the model's args, which the manifest doesn't
  // expose it in. The runtime anchors `cwd` to `ctx.workingDirectory` (and
  // refuses the model's own `cwd` while `trustArgsCwd` is off), which is exactly
  // the root the fence needs: a model must not get to choose what it is fenced
  // to. An unfenced command adds neither field and behaves as before.
  runCommand = (params: RunCommandParams, ctx?: BuiltinToolContext) =>
    this.execute(
      'runCommand',
      ctx?.localSandbox === true
        ? { ...params, sandbox: true, sandboxNetwork: ctx?.localSandboxNetwork === true }
        : params,
      ctx,
    );

  getCommandOutput = (params: GetCommandOutputParams, ctx?: BuiltinToolContext) =>
    this.execute('getCommandOutput', params, ctx);

  killCommand = (params: KillCommandParams, ctx?: BuiltinToolContext) =>
    this.execute('killCommand', params, ctx);

  // ==================== Search & Find ====================

  grepContent = (params: GrepContentParams, ctx?: BuiltinToolContext) =>
    this.execute('grepContent', params, ctx);

  globFiles = (params: GlobFilesParams, ctx?: BuiltinToolContext) =>
    this.execute('globFiles', params, ctx);

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
