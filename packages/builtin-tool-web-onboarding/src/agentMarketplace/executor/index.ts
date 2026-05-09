import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { AgentMarketplaceExecutionRuntime } from '../ExecutionRuntime';
import {
  AgentMarketplaceApiName,
  AgentMarketplaceIdentifier,
  type ShowAgentMarketplaceArgs,
  type SubmitAgentPickArgs,
} from '../types';

export class AgentMarketplaceExecutor extends BaseExecutor<typeof AgentMarketplaceApiName> {
  readonly identifier = AgentMarketplaceIdentifier;
  protected readonly apiEnum = AgentMarketplaceApiName;

  private runtime: AgentMarketplaceExecutionRuntime;

  constructor(runtime: AgentMarketplaceExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  showAgentMarketplace = async (
    params: ShowAgentMarketplaceArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.showAgentMarketplace(params, { topicId: ctx.topicId });
  };

  submitAgentPick = async (
    params: SubmitAgentPickArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.submitAgentPick(params);
  };
}

const fallbackRuntime = new AgentMarketplaceExecutionRuntime();

export const agentMarketplaceExecutor = new AgentMarketplaceExecutor(fallbackRuntime);
