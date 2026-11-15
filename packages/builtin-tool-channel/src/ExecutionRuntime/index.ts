import { projectChannelHistory } from '@lobechat/prompts/channel';
import type {
  BuiltinServerRuntimeOutput,
  ChannelDirectoryPage,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelListChannelsParams,
  ChannelReadMessageParams,
  ChannelReadMessagesParams,
  ChannelSendMessageParams,
  ChannelSentMessage,
} from '@lobechat/types';

export interface ChannelHistoryService {
  readMessage: (params: ChannelReadMessageParams) => Promise<ChannelHistoryMessageDetail>;
  readMessages: (params: ChannelReadMessagesParams) => Promise<ChannelHistoryPage>;
}

/** Reaching Agents in the requester's other Channels; the runtime binds the run and tool call. */
export interface ChannelMessagingService {
  listChannels: (params: ChannelListChannelsParams) => Promise<ChannelDirectoryPage>;
  sendMessage: (params: ChannelSendMessageParams) => Promise<ChannelSentMessage>;
}

export class ChannelExecutionRuntime {
  constructor(
    private readonly service: ChannelHistoryService,
    private readonly messaging?: ChannelMessagingService,
  ) {}

  private async result(
    read: () => Promise<ChannelHistoryMessageDetail | ChannelHistoryPage>,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = await read();
      return { content: JSON.stringify(projectChannelHistory(state)), state, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read Channel history';
      return { content: message, error: { type: 'ChannelHistoryError', message }, success: false };
    }
  }

  private async message(
    run: (messaging: ChannelMessagingService) => Promise<ChannelDirectoryPage | ChannelSentMessage>,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.messaging) throw new Error('Channel messaging is not available in this run');
      const state = await run(this.messaging);
      return { content: JSON.stringify(state), state, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reach that Channel';
      return {
        content: message,
        error: { type: 'ChannelMessagingError', message },
        success: false,
      };
    }
  }

  readMessages = (params: ChannelReadMessagesParams) =>
    this.result(() => this.service.readMessages(params));
  readMessage = (params: ChannelReadMessageParams) =>
    this.result(() => this.service.readMessage(params));
  listChannels = (params: ChannelListChannelsParams = {}) =>
    this.message((messaging) => messaging.listChannels(params));
  sendMessage = (params: ChannelSendMessageParams) =>
    this.message((messaging) => messaging.sendMessage(params));
}
