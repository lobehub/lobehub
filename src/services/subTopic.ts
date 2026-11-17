import { lambdaClient } from '@/libs/trpc/client';

type SubTopicRouter = typeof lambdaClient.subTopic;

export type OpenedSubTopic = Awaited<ReturnType<SubTopicRouter['listOpened']['query']>>[number];
export type SubTopicRetireResult = Awaited<ReturnType<SubTopicRouter['archive']['mutate']>>;
export type SubTopicDetachResult = Awaited<ReturnType<SubTopicRouter['detach']['mutate']>>;

/**
 * Sub-topics (`metadata.openedBy`): the sidebar hierarchy, archive / trash /
 * move-to-top-level, and the `lobe-topic` tool's client executor.
 */
class SubTopicService {
  listOpened = (openerTopicIds: string[]) =>
    lambdaClient.subTopic.listOpened.query({ openerTopicIds });

  archive = (topicId: string, mode: 'all' | 'self') =>
    lambdaClient.subTopic.archive.mutate({ mode, topicId });

  trash = (topicId: string, mode: 'all' | 'self') =>
    lambdaClient.subTopic.trash.mutate({ mode, topicId });

  detach = (topicIds: string[]) => lambdaClient.subTopic.detach.mutate({ topicIds });

  describe = (topicId: string) => lambdaClient.subTopic.describe.query({ topicId });

  open = (params: Parameters<SubTopicRouter['open']['mutate']>[0]) =>
    lambdaClient.subTopic.open.mutate(params);

  list = (openerTopicId: string) => lambdaClient.subTopic.list.query({ openerTopicId });

  get = (topicId: string) => lambdaClient.subTopic.get.query({ topicId });

  read = (topicId: string, limit: number) => lambdaClient.subTopic.read.query({ limit, topicId });

  send = (params: { message: string; sourceOperationId?: string; topicId: string }) =>
    lambdaClient.subTopic.send.mutate(params);

  stop = (topicId: string) => lambdaClient.subTopic.stop.mutate({ topicId });
}

export const subTopicService = new SubTopicService();
