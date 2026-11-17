import { TopicToolIdentifier } from '@lobechat/builtin-tool-topic';
import {
  type SubTopicToolService,
  TopicToolExecutionRuntime,
} from '@lobechat/builtin-tool-topic/executionRuntime';

import {
  createSubTopicService,
  readLatestSubTopicTranscript,
} from '@/server/routers/lambda/subTopic';
import { readSubTopicsEnabled } from '@/server/services/subTopic/labGate';

import type { ServerRuntimeRegistration } from './types';

/**
 * `lobe-topic`: the agent opens and manages sub-topics of the conversation
 * it runs in, through the same service the sidebar and `lh topic` use.
 */
export const subTopicRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for the sub-topic tool');
    }
    const db = context.serverDB;
    const userId = context.userId;
    const workspaceId = context.workspaceId ?? undefined;
    const service = createSubTopicService({ serverDB: db, userId, workspaceId });
    // The tool acts only on sub-topics of the conversation it runs in, never
    // on any other topic the account can see.
    const ownSubTopic = async (topicId: string) => {
      if (!context.topicId || !(await service.isOpenedBy(topicId, context.topicId))) {
        throw new Error(
          `${topicId} is not a sub-topic of this conversation; use listTopics to see the ones it opened.`,
        );
      }
    };

    const adapter: SubTopicToolService = {
      archive: async (topicId) => {
        await ownSubTopic(topicId);
        return service.retire({ action: 'archive', mode: 'self', topicId });
      },
      get: async (topicId) => {
        await ownSubTopic(topicId);
        const subTopic = await service.get(topicId);
        return {
          agentId: subTopic.agentId,
          lastReply: subTopic.lastReply,
          state: subTopic.state,
          title: subTopic.title,
          topicId,
        };
      },
      list: (openerTopicId) => service.list(openerTopicId),
      read: async (topicId, limit) => {
        await ownSubTopic(topicId);
        return readLatestSubTopicTranscript({ db, userId, workspaceId }, { limit, topicId }) as any;
      },
      send: async (params) => {
        await ownSubTopic(params.topicId);
        return service.send(params);
      },
      open: async (params) => {
        if (!(await readSubTopicsEnabled(db, userId))) {
          throw new Error('Sub-topics need Labs → Better Coding Experience, which is off.');
        }
        return service.open(params);
      },
      stop: async (topicId) => {
        await ownSubTopic(topicId);
        return service.stop(topicId);
      },
    };

    return new TopicToolExecutionRuntime(adapter, {
      operationId: context.operationId,
      topicId: context.topicId,
    });
  },
  identifier: TopicToolIdentifier,
};
