import { ChannelIdentifier } from '@lobechat/builtin-tool-channel';
import { ChannelExecutionRuntime } from '@lobechat/builtin-tool-channel/executionRuntime';

import { ChannelHistoryService } from '@/server/services/channel/ChannelHistoryService';
import { ChannelMessagingService } from '@/server/services/channel/ChannelMessagingService';
import { ChannelThreadService } from '@/server/services/channel/ChannelThreadService';

import type { ServerRuntimeRegistration } from './types';

export const channelRuntime: ServerRuntimeRegistration = {
  identifier: ChannelIdentifier,
  factory: (context) => {
    if (!context.serverDB || !context.userId || !context.operationId)
      throw new Error('Channel history requires an authenticated running operation');
    const messaging = new ChannelMessagingService(
      context.serverDB,
      context.userId,
      context.operationId,
      context.workspaceId,
    );
    const { toolCallId } = context;
    return new ChannelExecutionRuntime(
      new ChannelHistoryService(
        context.serverDB,
        context.userId,
        context.operationId,
        context.workspaceId,
      ),
      {
        listChannels: messaging.listChannels,
        listPeople: messaging.listPeople,
        messagePerson: (params) => {
          if (!toolCallId) throw new Error('Messaging a person requires a tool call id');
          return messaging.messagePerson(params, toolCallId);
        },
        sendMessage: (params) => {
          // The tool call id keys the post, so a retried call returns what it already sent.
          if (!toolCallId) throw new Error('Sending a Channel message requires a tool call id');
          return messaging.sendMessage(params, toolCallId);
        },
      },
      (() => {
        const threads = new ChannelThreadService(
          context.serverDB,
          context.userId,
          context.operationId,
          context.workspaceId,
        );
        // The tool call id keys every post, so a retried call returns what it already did.
        const keyed = () => {
          if (!toolCallId) throw new Error('Acting on a Thread requires a tool call id');
          return toolCallId;
        };
        return {
          createThread: (params) => threads.createThread(params, keyed()),
          listThreads: threads.listThreads,
          steerThread: (params) => threads.steerThread(params, keyed()),
          stopThread: threads.stopThread,
          unwatchThreads: threads.unwatchThreads,
          watchThreads: (params) => threads.watchThreads(params, keyed()),
        };
      })(),
    );
  },
};
