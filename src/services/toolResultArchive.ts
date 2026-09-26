import { lambdaClient } from '@/libs/trpc/client';
import { ARCHIVE_BYPASS_IDENTIFIERS, truncateToolResult } from '@/server/utils/truncateToolResult';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';

/**
 * The agent's configured tool-result limit. The server runtime reads it from the agent config;
 * without this the client path always fell back to the 25k default.
 */
const resolveAgentResultLimit = (agentId?: string | null) =>
  agentId
    ? chatConfigByIdSelectors.getChatConfigById(agentId)(getAgentStoreState()).toolResultMaxLength
    : undefined;

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

  const effectiveLimit = limit ?? resolveAgentResultLimit(agentId);

  if (!content || !toolCallId || !topicId) {
    return truncateToolResult(content, effectiveLimit);
  }

  try {
    const outcome = await lambdaClient.aiChat.archiveToolResult.mutate({
      agentId,
      content,
      identifier,
      limit: effectiveLimit,
      toolCallId,
      topicId,
    });
    return outcome.content;
  } catch {
    return truncateToolResult(content, effectiveLimit);
  }
};
