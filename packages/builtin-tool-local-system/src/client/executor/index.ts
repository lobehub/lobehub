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
import type { BuiltinToolContext, BuiltinToolResult, ToolExecutionDevice } from '@lobechat/types';
import { BaseExecutor, TOOL_CALL_DEVICE_ARG } from '@lobechat/types';

import { localFileService } from '@/services/electron/localFileService';
import { getElectronStoreState } from '@/store/electron';

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
    // This path runs the call in-process on this desktop and cannot reach any
    // other device, so a call naming another one fails rather than running
    // here. The argument never reaches the IPC layer.
    const { [TOOL_CALL_DEVICE_ARG]: deviceArg, ...callParams } = params;
    const electron = getElectronStoreState();
    // The cached info may still hold the install's fallback id; the stable id
    // (local IPC, no network) is what the server knows this desktop as.
    const deviceId =
      (await electron.resolveGatewayDeviceId()) ?? electron.gatewayDeviceInfo?.deviceId;
    const hostname = electron.gatewayDeviceInfo?.hostname || undefined;
    const requested = typeof deviceArg === 'string' ? deviceArg.trim() : deviceArg;
    const namedDevice = requested !== undefined && requested !== null && requested !== '';
    if (namedDevice) {
      const isSelf =
        typeof requested === 'string' &&
        ((!!deviceId && requested === deviceId) ||
          (!!hostname && requested.toLowerCase() === hostname.toLowerCase()));
      if (!isSelf) return this.otherDeviceResult(String(requested), hostname);
    }
    const executionDevice: ToolExecutionDevice | undefined = deviceId
      ? { deviceId, hostname, requested: namedDevice }
      : undefined;

    try {
      // `trustArgsCwd` stays off: `params` came straight from the model, and
      // `ctx.workingDirectory` is undefined whenever the agent has none
      // configured — so an off-contract `cwd` must be dropped here rather than
      // mistaken for a server-injected one.
      const output = await this.runtime.executeToolCall(
        apiName,
        apiName === 'runCommand'
          ? { ...callParams, topicId: ctx?.topicId ?? undefined, agentId: ctx?.agentId }
          : callParams,
        {
          workingDirectory: ctx?.workingDirectory,
        },
      );
      // apiEnum and the runtime dispatch cover the same tool set, so a null
      // (unknown tool) here is a programming error, not a user-facing state.
      if (!output) return this.errorResult(new Error(`Unknown local-system API: ${apiName}`));
      const result = this.toResult(output);
      return executionDevice ? { ...result, state: { ...result.state, executionDevice } } : result;
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
  // to. An unfenced command adds neither field and behaves as before. The
  // host-only `sandboxRoot` override is dropped for the same reason: a model
  // that guessed it could otherwise move its own fence.
  runCommand = (params: RunCommandParams, ctx?: BuiltinToolContext) => {
    const { sandboxRoot: _offContractSandboxRoot, ...modelParams } = params as RunCommandParams & {
      sandboxRoot?: unknown;
    };
    return this.execute(
      'runCommand',
      ctx?.localSandbox === true
        ? { ...modelParams, sandbox: true, sandboxNetwork: ctx?.localSandboxNetwork === true }
        : modelParams,
      ctx,
    );
  };

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

  private otherDeviceResult(requested: string, hostname: string | undefined): BuiltinToolResult {
    const message = `Device "${requested}" cannot be reached from here: this conversation runs tools in-process on this desktop${hostname ? ` (${hostname})` : ''} only, so the call was not run on it or anywhere else. Omit "${TOOL_CALL_DEVICE_ARG}" to run it on this desktop, or tell the user to pick that device in the chat input and send again.`;
    return {
      content: message,
      error: {
        body: { code: 'DEVICE_NOT_ACCESSIBLE', requestedDevice: requested },
        message,
        type: 'PluginServerError',
      },
      success: false,
    };
  }

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
