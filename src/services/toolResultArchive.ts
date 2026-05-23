import { lambdaClient } from '@/libs/trpc/client';
import { ARCHIVE_BYPASS_IDENTIFIERS, truncateToolResult } from '@/server/utils/truncateToolResult';

interface ArchiveParams {
  agentId?: string | null;
  content: string;
  identifier?: string;
  limit?: number;
  toolCallId?: string;
  topicId?: string | null;
}

export const archiveToolResultViaServer = async ({
  agentId,
  content,
  identifier,
  limit,
  toolCallId,
  topicId,
}: ArchiveParams): Promise<string> => {
  if (identifier && ARCHIVE_BYPASS_IDENTIFIERS.has(identifier)) {
    return content;
  }

  if (!content || !toolCallId || !topicId) {
    return truncateToolResult(content, limit);
  }

  try {
    const outcome = await lambdaClient.aiChat.archiveToolResult.mutate({
      agentId,
      content,
      identifier,
      limit,
      toolCallId,
      topicId,
    });
    return outcome.content;
  } catch {
    return truncateToolResult(content, limit);
  }
};
