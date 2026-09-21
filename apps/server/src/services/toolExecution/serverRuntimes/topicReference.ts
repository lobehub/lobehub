import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { TopicReferenceService } from '@/server/services/topicReference';

import type { ServerRuntimeRegistration } from './types';

export const topicReferenceRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for TopicReference execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for TopicReference execution');
    }
    const service = new TopicReferenceService(
      context.serverDB,
      context.userId,
      context.workspaceId,
    );
    return {
      getTopicContext: async (params: { topicId: string }): Promise<BuiltinServerRuntimeOutput> => {
        try {
          return await service.getTopicContext(params);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: `Failed to fetch topic context: ${errorMessage}`,
            error,
            success: false,
          };
        }
      },
    };
  },
  identifier: TopicReferenceIdentifier,
};
