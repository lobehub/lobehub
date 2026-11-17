import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { subTopicService } from '@/services/subTopic';

import { type SubTopicToolService, TopicToolExecutionRuntime } from '../../ExecutionRuntime';
import { TopicToolIdentifier } from '../../manifest';
import type {
  OpenTopicParams,
  ReadTopicParams,
  SendToTopicParams,
  TopicIdParams,
} from '../../types';
import { TopicToolApiName } from '../../types';

const service: SubTopicToolService = {
  archive: (topicId) => subTopicService.archive(topicId, 'self'),
  get: async (topicId) => {
    const subTopic = await subTopicService.get(topicId);
    return { ...subTopic, state: subTopic.state as any, topicId };
  },
  list: async (openerTopicId) => (await subTopicService.list(openerTopicId)) as any,
  read: async (topicId, limit) => (await subTopicService.read(topicId, limit)) as any,
  send: (params) => subTopicService.send(params),
  open: async (params) => {
    const started = await subTopicService.open(params);
    return { ...started, operationId: started.operationId ?? undefined } as any;
  },
  stop: (topicId) => subTopicService.stop(topicId),
};

/** Client-side runs reach the same `subTopic` service over tRPC. */
class TopicToolExecutor extends BaseExecutor<typeof TopicToolApiName> {
  readonly identifier = TopicToolIdentifier;
  protected readonly apiEnum = TopicToolApiName;

  private runtime = (ctx?: BuiltinToolContext) =>
    new TopicToolExecutionRuntime(service, {
      operationId: ctx?.operationId,
      topicId: ctx?.topicId,
    });

  private toResult(output: Awaited<ReturnType<TopicToolExecutionRuntime['openTopic']>>) {
    const message = output.error?.message ?? output.content ?? 'Sub-topic call failed';
    return output.success
      ? ({
          content: output.content,
          state: output.state,
          success: true,
        } satisfies BuiltinToolResult)
      : ({
          content: output.content || message,
          error: { message, type: output.error?.type ?? 'SubTopicError' },
          state: output.state,
          success: false,
        } satisfies BuiltinToolResult);
  }

  openTopic = async (params: OpenTopicParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).openTopic(params));

  listTopics = async (_params: unknown, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).listTopics());

  getTopic = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).getTopic(params));

  readTopic = async (params: ReadTopicParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).readTopic(params));

  sendToTopic = async (params: SendToTopicParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).sendToTopic(params));

  stopTopic = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).stopTopic(params));

  archiveTopic = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).archiveTopic(params));
}

export const topicToolExecutor = new TopicToolExecutor();
