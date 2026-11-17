import type { BuiltinToolContext, BuiltinToolResult, ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { subTopicService } from '@/services/subTopic';
import { useChatStore } from '@/store/chat';

import { type SubTopicToolService, TopicToolExecutionRuntime } from '../../ExecutionRuntime';
import { TopicToolIdentifier } from '../../manifest';
import type {
  OpenTopicParams,
  ReadTopicParams,
  SendToTopicParams,
  TopicIdParams,
} from '../../types';
import { TopicToolApiName } from '../../types';

const log = debug('lobe-topic:executor');

/** Calls that change what the sidebar hierarchy and the Overview show. */
const TREE_MUTATING_APIS = new Set<string>([
  TopicToolApiName.openTopic,
  TopicToolApiName.sendToTopic,
  TopicToolApiName.stopTopic,
]);

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

  /**
   * The call changed sub-topics outside the chat store (server-side, from
   * either runtime): re-read the hierarchy on screen so a new, running,
   * stopped or archived sub-topic shows without waiting for the next poll.
   */
  onAfterCall = async ({ apiName, result }: ToolAfterCallContext) => {
    if (!result.success) return;
    const archived = apiName === TopicToolApiName.archiveTopic;
    if (!archived && !TREE_MUTATING_APIS.has(apiName)) return;

    const store = useChatStore.getState();
    try {
      await Promise.all([
        store.refreshSubTopics(),
        // Archiving moves that sub-topic's own sub-topics to their agents' lists.
        archived ? store.refreshTopic() : undefined,
      ]);
    } catch (error) {
      log('refresh after %s failed: %o', apiName, error);
    }
  };

  /** Run one API and, like the gateway does for server runs, fire `onAfterCall`. */
  private async call(
    apiName: string,
    params: unknown,
    output: Awaited<ReturnType<TopicToolExecutionRuntime['openTopic']>>,
  ) {
    const result = this.toResult(output);
    // The client runtime never fires `onAfterCall` (only streamed gateway
    // results do), so sync the hierarchy here too.
    await this.onAfterCall({ apiName, identifier: this.identifier, params, result });
    return result;
  }

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
    this.call(TopicToolApiName.openTopic, params, await this.runtime(ctx).openTopic(params));

  listTopics = async (_params: unknown, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).listTopics());

  getTopic = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).getTopic(params));

  readTopic = async (params: ReadTopicParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).readTopic(params));

  sendToTopic = async (params: SendToTopicParams, ctx?: BuiltinToolContext) =>
    this.call(TopicToolApiName.sendToTopic, params, await this.runtime(ctx).sendToTopic(params));

  stopTopic = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.call(TopicToolApiName.stopTopic, params, await this.runtime(ctx).stopTopic(params));

  archiveTopic = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.call(TopicToolApiName.archiveTopic, params, await this.runtime(ctx).archiveTopic(params));
}

export const topicToolExecutor = new TopicToolExecutor();
