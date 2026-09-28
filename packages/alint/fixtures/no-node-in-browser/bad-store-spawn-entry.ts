// Fixture: a client store action importing the Node-only spawn entry of a workspace package.
// alint-expect
import { AgentStreamPipeline } from '@lobechat/heterogeneous-agents/spawn';

export const createLocalPipeline = (operationId: string) =>
  new AgentStreamPipeline({ agentType: 'kimi-code', operationId });
