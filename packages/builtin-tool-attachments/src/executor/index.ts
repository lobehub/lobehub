import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import type { AttachmentsExecutionRuntime } from '../ExecutionRuntime';
import type { ReadAttachmentArgs } from '../types';
import { AttachmentsApiName, AttachmentsIdentifier } from '../types';

export class AttachmentsExecutor extends BaseExecutor<typeof AttachmentsApiName> {
  readonly identifier = AttachmentsIdentifier;
  protected readonly apiEnum = AttachmentsApiName;
  private runtime: AttachmentsExecutionRuntime;

  constructor(runtime: AttachmentsExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  readAttachment = async (
    params: ReadAttachmentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { content, error, state, success } = await this.runtime.readAttachment(params, {
      signal: ctx.signal,
    });
    if (success) return { content, state, success };

    return {
      content,
      error: error
        ? { body: error, message: (error as Error).message ?? content, type: 'PluginServerError' }
        : undefined,
      state,
      success: false,
    };
  };
}
