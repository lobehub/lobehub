import type { LobeChatDatabase } from '@lobechat/database';

import { TopicDocumentModel } from '@/database/models/topicDocument';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import {
  DEFAULT_TOOL_RESULT_MAX_LENGTH,
  truncateToolResult,
} from '@/server/utils/truncateToolResult';

const TOOL_RESULTS_DIR = './.tool-results';

export interface ToolResultArchiveOutcome {
  archived: boolean;
  archivePath?: string;
  content: string;
  error?: string;
}

interface ArchiveToolResultParams {
  agentId?: string | null;
  content: string;
  limit?: number;
  serverDB?: LobeChatDatabase;
  toolCallId?: string;
  topicId?: string | null;
  userId?: string;
}

const buildArchivePath = (toolCallId: string) => `${TOOL_RESULTS_DIR}/${toolCallId}.md`;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error || 'Unknown archive error');

export const archiveToolResultIfNeeded = async ({
  agentId,
  content,
  limit,
  serverDB,
  toolCallId,
  topicId,
  userId,
}: ArchiveToolResultParams): Promise<ToolResultArchiveOutcome> => {
  const maxLength = limit ?? DEFAULT_TOOL_RESULT_MAX_LENGTH;

  if (!content || content.length <= maxLength) {
    return { archived: false, content };
  }

  const truncatedContent = truncateToolResult(content, maxLength);

  if (!agentId || !topicId || !toolCallId || !serverDB || !userId) {
    return { archived: false, content: truncatedContent };
  }

  const archivePath = buildArchivePath(toolCallId);

  try {
    const vfsService = new AgentDocumentVfsService(serverDB, userId);
    await vfsService.mkdir(TOOL_RESULTS_DIR, { agentId, topicId }, { recursive: true });
    const stats = await vfsService.write(archivePath, content, { agentId, topicId });

    if (stats.documentId) {
      const topicDocumentModel = new TopicDocumentModel(serverDB, userId);
      const associated = await topicDocumentModel.isAssociated(stats.documentId, topicId);
      if (!associated) {
        await topicDocumentModel.associate({
          documentId: stats.documentId,
          topicId,
        });
      }
    }

    return {
      archivePath,
      archived: true,
      content: `${truncatedContent}\nFull content archived at: ${archivePath}\nUse the document/file reading tool to inspect specific sections if needed.`,
    };
  } catch (error) {
    const message = getErrorMessage(error);

    return {
      archivePath,
      archived: false,
      content: `${truncatedContent}\n[Archive failed: ${message}. Full content was not persisted.]`,
      error: message,
    };
  }
};
