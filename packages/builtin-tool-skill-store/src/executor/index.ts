import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import type { SkillStoreExecutionRuntime } from '../ExecutionRuntime';
import {
  type ImportFromMarketParams,
  type ImportSkillParams,
  type SearchSkillParams,
  SkillStoreApiName,
  SkillStoreIdentifier,
} from '../types';

class SkillStoreExecutor extends BaseExecutor<typeof SkillStoreApiName> {
  readonly identifier = SkillStoreIdentifier;
  protected readonly apiEnum = SkillStoreApiName;

  private runtime: SkillStoreExecutionRuntime;

  constructor(runtime: SkillStoreExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  importSkill = async (
    params: ImportSkillParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.runtime.importSkill(params);

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

  searchSkill = async (
    params: SearchSkillParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.runtime.searchSkill(params);

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

  importFromMarket = async (
    params: ImportFromMarketParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.runtime.importFromMarket(params);

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

export { SkillStoreExecutor };
