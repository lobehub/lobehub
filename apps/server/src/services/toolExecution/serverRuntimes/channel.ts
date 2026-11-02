import { ChannelIdentifier } from '@lobechat/builtin-tool-channel';
import { ChannelExecutionRuntime } from '@lobechat/builtin-tool-channel/executionRuntime';

import { ChannelHistoryService } from '@/server/services/channel/ChannelHistoryService';

import type { ServerRuntimeRegistration } from './types';

export const channelRuntime: ServerRuntimeRegistration = {
  identifier: ChannelIdentifier,
  factory: (context) => {
    if (!context.serverDB || !context.userId || !context.operationId)
      throw new Error('Channel history requires an authenticated running operation');
    return new ChannelExecutionRuntime(
      new ChannelHistoryService(
        context.serverDB,
        context.userId,
        context.operationId,
        context.workspaceId,
      ),
    );
  },
};
