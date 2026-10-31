import { projectChannelHistory } from '@lobechat/prompts/channel';
import type {
  BuiltinServerRuntimeOutput,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelReadMessageParams,
  ChannelReadMessagesParams,
} from '@lobechat/types';

export interface ChannelHistoryService {
  readMessage: (params: ChannelReadMessageParams) => Promise<ChannelHistoryMessageDetail>;
  readMessages: (params: ChannelReadMessagesParams) => Promise<ChannelHistoryPage>;
}

export class ChannelExecutionRuntime {
  constructor(private readonly service: ChannelHistoryService) {}

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

  readMessages = (params: ChannelReadMessagesParams) =>
    this.result(() => this.service.readMessages(params));
  readMessage = (params: ChannelReadMessageParams) =>
    this.result(() => this.service.readMessage(params));
}
