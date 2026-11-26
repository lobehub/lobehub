import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import type { ActivatorExecutionRuntime } from '../ExecutionRuntime';
import {
  type ActivateSkillParams,
  type ActivateToolsParams,
  ActivatorApiName,
  LobeActivatorIdentifier,
} from '../types';

class ActivatorExecutor extends BaseExecutor<typeof ActivatorApiName> {
  readonly identifier = LobeActivatorIdentifier;
  protected readonly apiEnum = ActivatorApiName;

  private getRuntime: (ctx: BuiltinToolContext) => ActivatorExecutionRuntime;

  constructor(
    runtime: ActivatorExecutionRuntime | ((ctx: BuiltinToolContext) => ActivatorExecutionRuntime),
  ) {
    super();
    this.getRuntime = typeof runtime === 'function' ? runtime : () => runtime;
  }

  activateSkill = async (
    params: ActivateSkillParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.getRuntime(ctx).activateSkill(params);

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

  activateTools = async (
    params: ActivateToolsParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      // Discoverability follows the conversation the call runs in
      const result = await this.getRuntime(ctx).activateTools(params, {
        agentId: ctx.agentId,
        topicId: ctx.topicId ?? undefined,
      });

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

export { ActivatorExecutor };
