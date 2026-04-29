import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { AgentMarketplaceExecutionRuntime } from '../ExecutionRuntime';
import {
  AgentMarketplaceApiName,
  AgentMarketplaceIdentifier,
  type CancelAgentPickArgs,
  type GetPickStateArgs,
  type ShowAgentMarketplaceArgs,
  type SkipAgentPickArgs,
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
    // TODO(LOBE-7801): after submit, install the selected templates into the
    // user workspace (clone from lobehub/agent-template into sessions table).
    // For MVP we only record the selection and let the agent acknowledge verbally.
    return this.runtime.submitAgentPick(params);
  };

  skipAgentPick = async (
    params: SkipAgentPickArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.skipAgentPick(params);
  };

  cancelAgentPick = async (
    params: CancelAgentPickArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.cancelAgentPick(params);
  };

  getPickState = async (
    params: GetPickStateArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.getPickState(params);
  };
}

const fallbackRuntime = new AgentMarketplaceExecutionRuntime();

export const agentMarketplaceExecutor = new AgentMarketplaceExecutor(fallbackRuntime);
