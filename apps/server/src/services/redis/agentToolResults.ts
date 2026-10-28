import {
  type McpInvocationIdentity,
  mcpInvocationKey,
  mcpTransportCallId,
} from '@lobechat/mcp-elicitation/transport';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import type { ToolResultPayload } from '@/server/modules/AgentRuntime/ToolResultWaiter';

/** Owns the legacy runtime waiter's wire key, TTL and first-delivery policy. */
export const agentToolResults = {
  async claimMcpProducer(
    scope: McpInvocationIdentity,
    producerId: string,
    fingerprint: string,
    deadline: number,
  ) {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) throw new Error('Redis is unavailable for MCP invocation ownership');
    if (deadline <= Date.now()) return false;
    const key = `mcp_producer:${mcpInvocationKey(scope)}`;
    const value = JSON.stringify({ producerId, fingerprint });
    return (
      (await redis.eval(
        `local value=redis.call('GET',KEYS[1]); if value then if value==ARGV[1] then return 1 else return 0 end end; redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[2]); return 1`,
        1,
        key,
        value,
        Math.max(1, Math.min(deadline - Date.now(), 120000) + 300000),
      )) === 1
    );
  },
  async publishMcpResult(scope: McpInvocationIdentity, result: ToolResultPayload) {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) throw new Error('Redis is unavailable for MCP tool completion');
    if (result.toolCallId !== scope.toolCallId) throw new Error('MCP result invocation mismatch');
    await redis.eval(
      `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      redis.call('LPUSH', KEYS[2], ARGV[1])
      redis.call('EXPIRE', KEYS[2], 300)
      redis.call('SET', KEYS[1], '1', 'EX', 300)
      return 1
    `,
      2,
      `tool_result:mcp-delivered:${mcpInvocationKey(scope)}`,
      `tool_result:${mcpTransportCallId(scope)}`,
      JSON.stringify(result),
    );
  },
};
