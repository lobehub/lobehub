import { lambdaClient } from '@/libs/trpc/client';

type SubSessionRouter = typeof lambdaClient.subSession;

export type OpenedSubSession = Awaited<ReturnType<SubSessionRouter['listOpened']['query']>>[number];
export type SubSessionRetireResult = Awaited<ReturnType<SubSessionRouter['archive']['mutate']>>;
export type SubSessionDetachResult = Awaited<ReturnType<SubSessionRouter['detach']['mutate']>>;

/**
 * Sub-sessions (`metadata.openedBy`): the sidebar hierarchy, archive / trash /
 * move-to-top-level, and the `lobe-session` tool's client executor.
 */
class SubSessionService {
  listOpened = (openerTopicIds: string[]) =>
    lambdaClient.subSession.listOpened.query({ openerTopicIds });

  archive = (topicId: string, mode: 'all' | 'self') =>
    lambdaClient.subSession.archive.mutate({ mode, topicId });

  trash = (topicId: string, mode: 'all' | 'self') =>
    lambdaClient.subSession.trash.mutate({ mode, topicId });

  detach = (topicIds: string[]) => lambdaClient.subSession.detach.mutate({ topicIds });

  describe = (topicId: string) => lambdaClient.subSession.describe.query({ topicId });

  start = (params: Parameters<SubSessionRouter['start']['mutate']>[0]) =>
    lambdaClient.subSession.start.mutate(params);

  list = (openerTopicId: string) => lambdaClient.subSession.list.query({ openerTopicId });

  get = (topicId: string) => lambdaClient.subSession.get.query({ topicId });

  read = (topicId: string, limit: number) => lambdaClient.subSession.read.query({ limit, topicId });

  send = (params: { message: string; sourceOperationId?: string; topicId: string }) =>
    lambdaClient.subSession.send.mutate(params);

  stop = (topicId: string) => lambdaClient.subSession.stop.mutate({ topicId });
}

export const subSessionService = new SubSessionService();
