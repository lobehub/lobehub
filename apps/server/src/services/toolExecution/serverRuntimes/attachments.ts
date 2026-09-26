import { AttachmentsIdentifier } from '@lobechat/builtin-tool-attachments';
import { AttachmentsExecutionRuntime } from '@lobechat/builtin-tool-attachments/executionRuntime';

import { KnowledgeBaseSearchService } from '@/server/services/knowledgeBase';

import { type ServerRuntimeRegistration } from './types';

/**
 * Reads files through the same user/workspace/agent-visibility scope as `readKnowledge`, so an
 * attachment preview can be paged without enabling the knowledge-base tool.
 */
export const attachmentsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { userId, serverDB, agentVisibility, workspaceId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for attachment reads');
    }

    const searchService = new KnowledgeBaseSearchService(
      serverDB,
      userId,
      workspaceId,
      agentVisibility,
    );

    return new AttachmentsExecutionRuntime({
      getFileContents: (fileIds) => searchService.getFileContents(fileIds),
    });
  },
  identifier: AttachmentsIdentifier,
};
