import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import {
  A2uiApiName,
  A2uiIdentifier,
  type ReadCardDocsParams,
  type RenderUIParams,
} from '../../types';

/** Where the card tool runs: the package runtime on a server, or a forwarder to it in a browser. */
export interface A2uiToolRuntime {
  readCardDocs: (params: ReadCardDocsParams) => Promise<BuiltinToolResult>;
  renderUI: (params: RenderUIParams) => Promise<BuiltinToolResult>;
}

export class A2uiExecutor extends BaseExecutor<typeof A2uiApiName> {
  readonly identifier = A2uiIdentifier;
  protected readonly apiEnum = A2uiApiName;

  private runtime: A2uiToolRuntime;

  constructor(runtime: A2uiToolRuntime) {
    super();
    this.runtime = runtime;
  }

  renderUI = async (params: RenderUIParams, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.renderUI(params);

  readCardDocs = async (
    params: ReadCardDocsParams,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.runtime.readCardDocs(params);
}
