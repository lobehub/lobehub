import type { PendingMcpElicitation } from '@lobechat/types';
import type { ElicitResult } from '@modelcontextprotocol/client';

import { lambdaClient } from '@/libs/trpc/client';

class McpElicitationService {
  recover = (itemId: string) => lambdaClient.mcpElicitation.recover.mutate({ itemId });
  pending = (topicId: string, threadId?: string | null): Promise<PendingMcpElicitation[]> =>
    lambdaClient.mcpElicitation.pending.query({ topicId, threadId });
  resolve = (
    itemId: string,
    resolutionRequestId: string,
    responses: Record<string, ElicitResult>,
  ) => lambdaClient.mcpElicitation.resolve.mutate({ itemId, resolutionRequestId, responses });
}

export const mcpElicitationService = new McpElicitationService();
export type { PendingMcpElicitation } from '@lobechat/types';
