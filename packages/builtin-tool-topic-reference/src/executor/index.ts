import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

import { TopicReferenceIdentifier } from '../types';

const TopicReferenceApiName = {
  getTopicContext: 'getTopicContext',
} as const;

interface GetTopicContextParams {
  topicId: string;
}

class TopicReferenceExecutor extends BaseExecutor<typeof TopicReferenceApiName> {
  readonly identifier = TopicReferenceIdentifier;
  protected readonly apiEnum = TopicReferenceApiName;

  getTopicContext = async (
    params: GetTopicContextParams,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { topicId } = params;

    if (!topicId) {
      return { content: 'topicId is required', success: false };
    }

    try {
      const result = await lambdaClient.topic.getTopicContext.query({ topicId });
      return { content: result.content, success: result.success };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: `Failed to fetch topic context: ${errorMessage}`, success: false };
    }
  };
}

export const topicReferenceExecutor = new TopicReferenceExecutor();
