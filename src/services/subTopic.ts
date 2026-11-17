import type { OpenedSubTopic, SubTopicDetachResult, SubTopicRetireResult } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

type SubTopicRouter = typeof lambdaClient.subTopic;

export type { OpenedSubTopic, SubTopicDetachResult, SubTopicRetireResult };

/**
 * Sub-topics (`metadata.openedBy`): the sidebar hierarchy, archive / trash /
 * move-to-top-level, and the `lobe-topic` tool's client executor.
 */
class SubTopicService {
  listOpened = (openerTopicIds: string[]): Promise<OpenedSubTopic[]> =>
    lambdaClient.subTopic.listOpened.query({ openerTopicIds });

  archive = (topicId: string, mode: 'all' | 'self'): Promise<SubTopicRetireResult> =>
    lambdaClient.subTopic.archive.mutate({ mode, topicId });

  trash = (
    topicId: string,
    mode: 'all' | 'self',
    removeFiles?: boolean,
  ): Promise<SubTopicRetireResult> =>
    lambdaClient.subTopic.trash.mutate({ mode, removeFiles, topicId });

  detach = (topicIds: string[]): Promise<SubTopicDetachResult> =>
    lambdaClient.subTopic.detach.mutate({ topicIds });

  describe = (topicId: string) => lambdaClient.subTopic.describe.query({ topicId });

  open = (params: Parameters<SubTopicRouter['open']['mutate']>[0]) =>
    lambdaClient.subTopic.open.mutate(params);

  list = (openerTopicId: string) => lambdaClient.subTopic.list.query({ openerTopicId });

  get = (topicId: string) => lambdaClient.subTopic.get.query({ topicId });

  isOpenedBy = (topicId: string, openerTopicId: string) =>
    lambdaClient.subTopic.isOpenedBy.query({ openerTopicId, topicId });

  read = (topicId: string, limit: number) => lambdaClient.subTopic.read.query({ limit, topicId });

  send = (params: { message: string; sourceOperationId?: string; topicId: string }) =>
    lambdaClient.subTopic.send.mutate(params);

  stop = (topicId: string) => lambdaClient.subTopic.stop.mutate({ topicId });
}

export const subTopicService = new SubTopicService();
