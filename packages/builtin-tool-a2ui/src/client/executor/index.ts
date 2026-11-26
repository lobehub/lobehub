import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import type { A2uiExecutionRuntime } from '../../ExecutionRuntime';
import { A2uiApiName, A2uiIdentifier, type RenderUIParams } from '../../types';

export class A2uiExecutor extends BaseExecutor<typeof A2uiApiName> {
  readonly identifier = A2uiIdentifier;
  protected readonly apiEnum = A2uiApiName;

  private runtime: A2uiExecutionRuntime;

  constructor(runtime: A2uiExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  renderUI = async (params: RenderUIParams, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.renderUI(params);
}
