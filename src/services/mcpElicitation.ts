import type { ElicitResult } from '@modelcontextprotocol/client';

import { lambdaClient } from '@/libs/trpc/client';

class McpElicitationService {
  pending = (topicId: string, threadId?: string | null) =>
    lambdaClient.mcpElicitation.pending.query({ topicId, threadId });
  resolve = (
    itemId: string,
    resolutionRequestId: string,
    responses: Record<string, ElicitResult>,
  ) => lambdaClient.mcpElicitation.resolve.mutate({ itemId, resolutionRequestId, responses });
}

export const mcpElicitationService = new McpElicitationService();
export type PendingMcpElicitation = Awaited<ReturnType<McpElicitationService['pending']>>[number];
