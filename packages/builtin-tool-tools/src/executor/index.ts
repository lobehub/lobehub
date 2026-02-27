import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import type { ToolsActivatorExecutionRuntime } from '../ExecutionRuntime';
import { type ActivateToolsParams, LobeToolIdentifier, ToolsActivatorApiName } from '../types';

class ToolsActivatorExecutor extends BaseExecutor<typeof ToolsActivatorApiName> {
  readonly identifier = LobeToolIdentifier;
  protected readonly apiEnum = ToolsActivatorApiName;

  private runtime: ToolsActivatorExecutionRuntime;

  constructor(runtime: ToolsActivatorExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  activateTools = async (
    params: ActivateToolsParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.runtime.activateTools(params);

      if (result.success) {
        return { content: result.content, state: result.state, success: true };
      }

      return {
        content: result.content,
        error: { message: result.content, type: 'PluginServerError' },
        success: false,
      };
    } catch (e) {
      const err = e as Error;
      return {
        error: { body: e, message: err.message, type: 'PluginServerError' },
        success: false,
      };
    }
  };
}

export { ToolsActivatorExecutor };
