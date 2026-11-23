import { projectChannelHistory } from '@lobechat/prompts/channel';
import type {
  BuiltinServerRuntimeOutput,
  ChannelConnectorRequestResult,
  ChannelCreatedThread,
  ChannelCreateThreadParams,
  ChannelDirectoryPage,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelListChannelsParams,
  ChannelListPeopleParams,
  ChannelListThreadsParams,
  ChannelMessagePersonParams,
  ChannelPeoplePage,
  ChannelReadMessageParams,
  ChannelReadMessagesParams,
  ChannelRequestConnectorParams,
  ChannelSendMessageParams,
  ChannelSentMessage,
  ChannelSentPersonMessage,
  ChannelSteeredThread,
  ChannelSteerThreadParams,
  ChannelStoppedThread,
  ChannelStopThreadParams,
  ChannelThreadPage,
  ChannelUnwatchThreadsParams,
  ChannelWatchedThreads,
  ChannelWatchThreadsParams,
} from '@lobechat/types';

export interface ChannelHistoryService {
  readMessage: (params: ChannelReadMessageParams) => Promise<ChannelHistoryMessageDetail>;
  readMessages: (params: ChannelReadMessagesParams) => Promise<ChannelHistoryPage>;
  /** Posts a card in the run's conversation; the runtime binds the run and tool call. */
  requestConnector?: (
    params: ChannelRequestConnectorParams,
  ) => Promise<ChannelConnectorRequestResult>;
}

/**
 * Reaching Agents in the requester's other Channels, and people in the requester's one-on-one
 * conversations; the runtime binds the run and tool call.
 */
export interface ChannelMessagingService {
  listChannels: (params: ChannelListChannelsParams) => Promise<ChannelDirectoryPage>;
  listPeople: (params: ChannelListPeopleParams) => Promise<ChannelPeoplePage>;
  messagePerson: (params: ChannelMessagePersonParams) => Promise<ChannelSentPersonMessage>;
  sendMessage: (params: ChannelSendMessageParams) => Promise<ChannelSentMessage>;
}

/**
 * The calling Agent's own replies in the other Threads of its Channel; the runtime binds the run
 * and tool call.
 */
export interface ChannelThreadService {
  createThread: (params: ChannelCreateThreadParams) => Promise<ChannelCreatedThread>;
  listThreads: (params: ChannelListThreadsParams) => Promise<ChannelThreadPage>;
  steerThread: (params: ChannelSteerThreadParams) => Promise<ChannelSteeredThread>;
  stopThread: (params: ChannelStopThreadParams) => Promise<ChannelStoppedThread>;
  unwatchThreads: (params: ChannelUnwatchThreadsParams) => Promise<{ watchId: string }>;
  watchThreads: (params: ChannelWatchThreadsParams) => Promise<ChannelWatchedThreads>;
}

export class ChannelExecutionRuntime {
  constructor(
    private readonly service: ChannelHistoryService,
    private readonly messaging?: ChannelMessagingService,
    private readonly threads?: ChannelThreadService,
  ) {}

  private async thread(
    run: (threads: ChannelThreadService) => Promise<unknown>,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.threads) throw new Error('Channel Threads are not available in this run');
      const state = await run(this.threads);
      return { content: JSON.stringify(state), state, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not act on that Thread';
      return { content: message, error: { type: 'ChannelThreadError', message }, success: false };
    }
  }

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
    run: (
      messaging: ChannelMessagingService,
    ) => Promise<
      ChannelDirectoryPage | ChannelPeoplePage | ChannelSentMessage | ChannelSentPersonMessage
    >,
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

  requestConnector = async (
    params: ChannelRequestConnectorParams,
  ): Promise<BuiltinServerRuntimeOutput> => {
    try {
      if (!this.service.requestConnector)
        throw new Error('Connector requests are not available in this run');
      const state = await this.service.requestConnector(params);
      return {
        content: `Posted a card asking the person to connect ${state.name}. They connect it from the card; it is usable from your next turn once connected.`,
        state,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not ask for that connector';
      return {
        content: message,
        error: { type: 'ChannelConnectorError', message },
        success: false,
      };
    }
  };
  readMessages = (params: ChannelReadMessagesParams) =>
    this.result(() => this.service.readMessages(params));
  readMessage = (params: ChannelReadMessageParams) =>
    this.result(() => this.service.readMessage(params));
  listChannels = (params: ChannelListChannelsParams = {}) =>
    this.message((messaging) => messaging.listChannels(params));
  listPeople = (params: ChannelListPeopleParams = {}) =>
    this.message((messaging) => messaging.listPeople(params));
  messagePerson = (params: ChannelMessagePersonParams) =>
    this.message((messaging) => messaging.messagePerson(params));
  sendMessage = (params: ChannelSendMessageParams) =>
    this.message((messaging) => messaging.sendMessage(params));
  listThreads = (params: ChannelListThreadsParams = {}) =>
    this.thread((threads) => threads.listThreads(params));
  createThread = (params: ChannelCreateThreadParams) =>
    this.thread((threads) => threads.createThread(params));
  stopThread = (params: ChannelStopThreadParams) =>
    this.thread((threads) => threads.stopThread(params));
  steerThread = (params: ChannelSteerThreadParams) =>
    this.thread((threads) => threads.steerThread(params));
  watchThreads = (params: ChannelWatchThreadsParams) =>
    this.thread((threads) => threads.watchThreads(params));
  unwatchThreads = (params: ChannelUnwatchThreadsParams) =>
    this.thread((threads) => threads.unwatchThreads(params));
}
