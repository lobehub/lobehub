import type { Agent, GeneralAgentConfig } from '@lobechat/agent-runtime';
import { GeneralChatAgent, GraphAgent } from '@lobechat/agent-runtime';
import type { LobeAgentChatConfig, LobeAgentConfig } from '@lobechat/types';
import { AgentGraphSchema } from '@lobechat/types';
import debug from 'debug';

import type { AgentRuntimeServiceOptions } from '@/server/services/agentRuntime/AgentRuntimeService';

const log = debug('lobe-server:ai-agent-service');

/**
 * Content written onto a tool row that the user stopped before it ran. Mirrors
 * the runtime's aborted-tool wording so a stopped call reads the same whether
 * it was settled here or by `resolve_aborted_tools`.
 */
export const STOPPED_TOOL_CONTENT = 'Tool execution was aborted by user.';

export const createGraphAwareAgentFactory =
  (
    upstreamFactory?: AgentRuntimeServiceOptions['agentFactory'],
  ): ((config: GeneralAgentConfig) => Agent) =>
  (config) => {
    if (upstreamFactory) {
      return upstreamFactory(config);
    }

    const runtimeAgentConfig = config.agentConfig as LobeAgentConfig | undefined;
    // Graph Agent is an agency-level behavior: read from `agencyConfig`.
    // Legacy rows stored the graph on `chatConfig` — fall back so existing
    // agents keep running until their next write migrates them.
    const agencyConfig = runtimeAgentConfig?.agencyConfig;
    const legacyChatConfig = runtimeAgentConfig?.chatConfig as
      (LobeAgentChatConfig & { enableGraphMode?: boolean; graph?: unknown }) | undefined;
    const graph = agencyConfig?.graph ?? legacyChatConfig?.graph;
    const graphEnabled =
      (agencyConfig?.enableGraphMode ?? legacyChatConfig?.enableGraphMode) === true;
    if (graphEnabled && graph) {
      const graphResult = AgentGraphSchema.safeParse(graph);

      if (graphResult.success) {
        return new GraphAgent({ ...config, graph: graphResult.data });
      }

      log('Invalid graph agent snapshot, falling back to default runtime: %O', graphResult.error);
    }

    return new GeneralChatAgent(config);
  };
