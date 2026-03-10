import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import type { CredentialsExecutionRuntime } from '../ExecutionRuntime';
import {
  CredentialsApiName,
  CredentialsIdentifier,
  type DeleteCredentialParams,
  type GetCredentialParams,
  type ListCredentialsParams,
  type SetCredentialParams,
} from '../types';

export class CredentialsExecutor extends BaseExecutor<typeof CredentialsApiName> {
  readonly identifier = CredentialsIdentifier;
  protected readonly apiEnum = CredentialsApiName;

  private readonly runtime: CredentialsExecutionRuntime;

  constructor(runtime: CredentialsExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  setCredential = async (
    params: SetCredentialParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    if (ctx.signal?.aborted) return { stop: true, success: false };

    const result = await this.runtime.setCredential(params);

    return result.success
      ? { content: result.content, state: result.state, success: true }
      : {
          content: result.content,
          error: { message: result.content, type: 'PluginServerError' },
          success: false,
        };
  };

  getCredential = async (
    params: GetCredentialParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    if (ctx.signal?.aborted) return { stop: true, success: false };

    const result = await this.runtime.getCredential(params);

    return result.success
      ? { content: result.content, state: result.state, success: true }
      : {
          content: result.content,
          error: { message: result.content, type: 'PluginServerError' },
          success: false,
        };
  };

  listCredentials = async (
    params: ListCredentialsParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    if (ctx.signal?.aborted) return { stop: true, success: false };

    const result = await this.runtime.listCredentials(params);

    return result.success
      ? { content: result.content, state: result.state, success: true }
      : {
          content: result.content,
          error: { message: result.content, type: 'PluginServerError' },
          success: false,
        };
  };

  deleteCredential = async (
    params: DeleteCredentialParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    if (ctx.signal?.aborted) return { stop: true, success: false };

    const result = await this.runtime.deleteCredential(params);

    return result.success
      ? { content: result.content, state: result.state, success: true }
      : {
          content: result.content,
          error: { message: result.content, type: 'PluginServerError' },
          success: false,
        };
  };
}
