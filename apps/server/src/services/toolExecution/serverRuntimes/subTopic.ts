import { TopicToolIdentifier } from '@lobechat/builtin-tool-topic';
import {
  type SubTopicToolService,
  TopicToolExecutionRuntime,
} from '@lobechat/builtin-tool-topic/executionRuntime';

import {
  createSubTopicService,
  readLatestSubTopicTranscript,
} from '@/server/routers/lambda/subTopic';
import { resolveDeviceAccessPolicy } from '@/server/services/aiAgent/deviceAccessPolicy';
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
    // A sub-topic turn runs as the account owner, without the IM sender's
    // provenance, so it would get the owner's devices. A sender this
    // conversation denies devices (an external one in a bot chat) must not
    // start one — the scoping to this conversation's own sub-topics is
    // enforced by the runtime itself.
    // A shared-agent visitor's run is the creator's identity too; it never starts one.
    const assertMayStartRuns = () => {
      if (context.agentShareVisitor) {
        throw new Error('Sub-topics cannot be started from a shared agent conversation.');
      }
      if (
        context.botContext &&
        !resolveDeviceAccessPolicy({ botContext: context.botContext }).canUseDevice
      ) {
        throw new Error(
          'Sub-topics can only be started or continued by the bot owner or a trusted sender in this chat.',
        );
      }
    };

    const adapter: SubTopicToolService = {
      archive: (topicId) => service.retire({ action: 'archive', mode: 'self', topicId }),
      get: async (topicId) => {
        const subTopic = await service.get(topicId);
        return {
          agentId: subTopic.agentId,
          lastReply: subTopic.lastReply,
          state: subTopic.state,
          title: subTopic.title,
          topicId,
        };
      },
      isOpenedBy: (topicId, openerTopicId) => service.isOpenedBy(topicId, openerTopicId),
      list: (openerTopicId) => service.list(openerTopicId),
      read: async (topicId, limit) =>
        readLatestSubTopicTranscript({ db, userId, workspaceId }, { limit, topicId }) as any,
      send: async (params) => {
        assertMayStartRuns();
        return service.send(params);
      },
      open: async (params) => {
        if (!(await readSubTopicsEnabled(db, userId))) {
          throw new Error('Sub-topics need Labs → Better Coding Experience, which is off.');
        }
        assertMayStartRuns();
        return service.open(params);
      },
      stop: (topicId) => service.stop(topicId),
    };

    return new TopicToolExecutionRuntime(adapter, {
      operationId: context.operationId,
      topicId: context.topicId,
    });
  },
  identifier: TopicToolIdentifier,
};
