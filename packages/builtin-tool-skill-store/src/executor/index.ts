import {
  BaseExecutor,
  type BuiltinToolContext,
  type BuiltinToolResult,
  type ToolAfterCallContext,
} from '@lobechat/types';

import type { SkillStoreExecutionRuntime } from '../ExecutionRuntime';
import {
  type ImportFromMarketParams,
  type ImportSkillParams,
  type SearchSkillParams,
  SkillStoreApiName,
  SkillStoreIdentifier,
} from '../types';

// APIs that import a skill into the user's library. Used by `onAfterCall` to
// decide when to refresh the client-side skills list.
const IMPORT_APIS = new Set<string>([
  SkillStoreApiName.importSkill,
  SkillStoreApiName.importFromMarket,
]);

class SkillStoreExecutor extends BaseExecutor<typeof SkillStoreApiName> {
  readonly identifier = SkillStoreIdentifier;
  protected readonly apiEnum = SkillStoreApiName;

  private runtime: SkillStoreExecutionRuntime;

  constructor(runtime: SkillStoreExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  // Refresh the client skills list after a successful import. Lives here rather
  // than inline in the runtime so it fires on `tool_end` regardless of whether
  // the import ran client- or server-side — the server-runtime path never
  // touches the client store otherwise.
  onAfterCall = async ({ apiName, result }: ToolAfterCallContext): Promise<void> => {
    if (!IMPORT_APIS.has(apiName) || !result.success) return;
    await this.runtime.notifyImported();
  };

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
