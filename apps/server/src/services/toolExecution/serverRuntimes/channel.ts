import { ChannelIdentifier } from '@lobechat/builtin-tool-channel';
import { ChannelExecutionRuntime } from '@lobechat/builtin-tool-channel/executionRuntime';

import { ChannelHistoryService } from '@/server/services/channel/ChannelHistoryService';
import { ChannelMessagingService } from '@/server/services/channel/ChannelMessagingService';

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
        sendMessage: (params) => {
          // The tool call id keys the post, so a retried call returns what it already sent.
          if (!toolCallId) throw new Error('Sending a Channel message requires a tool call id');
          return messaging.sendMessage(params, toolCallId);
        },
      },
    );
  },
};
