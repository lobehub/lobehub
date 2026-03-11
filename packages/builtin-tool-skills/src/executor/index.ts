import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import type { SkillsExecutionRuntime } from '../ExecutionRuntime';
import {
  type ExecScriptParams,
  type ExportFileParams,
  type ReadReferenceParams,
  type RunSkillParams,
  SkillsApiName,
  SkillsIdentifier,
} from '../types';

class SkillsExecutor extends BaseExecutor<typeof SkillsApiName> {
  readonly identifier = SkillsIdentifier;
  protected readonly apiEnum = SkillsApiName;

  private runtime: SkillsExecutionRuntime;

  constructor(runtime: SkillsExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  execScript = async (
    params: ExecScriptParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.runtime.execScript(params);

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

  runSkill = async (
    params: RunSkillParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.runtime.runSkill(params);

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

  readReference = async (
    params: ReadReferenceParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.runtime.readReference(params);

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

  exportFile = async (
    params: ExportFileParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const result = await this.runtime.exportFile(params);

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

export { SkillsExecutor };
