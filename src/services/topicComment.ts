import type {
  CreateTopicCommentInput,
  TopicCommentJson,
  UpdateTopicCommentInput,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class TopicCommentService {
  create = (input: CreateTopicCommentInput) => lambdaClient.topicComment.create.mutate(input);

  delete = (id: string) => lambdaClient.topicComment.delete.mutate({ id });

  get = (id: string) => lambdaClient.topicComment.get.query({ id });

  listReplies = (params: { cursor?: string; limit?: number; rootCommentId: string }) =>
    lambdaClient.topicComment.listReplies.query(params);

  listThreads = (params: {
    cursor?: string;
    limit?: number;
    messageId?: string;
    topicId: string;
  }) => lambdaClient.topicComment.listThreads.query(params);

  restore = (id: string) => lambdaClient.topicComment.restore.mutate({ id });

  summary = (topicId: string) => lambdaClient.topicComment.summary.query({ topicId });

  update = (input: UpdateTopicCommentInput & { editorData?: TopicCommentJson }) =>
    lambdaClient.topicComment.update.mutate(input);
}

export const topicCommentService = new TopicCommentService();
