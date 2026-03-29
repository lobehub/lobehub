import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import type { MessageExecutionRuntime } from '../ExecutionRuntime';
import type {
  ConnectBotParams,
  CreateBotParams,
  CreatePollParams,
  CreateThreadParams,
  DeleteBotParams,
  DeleteMessageParams,
  EditMessageParams,
  GetBotDetailParams,
  GetChannelInfoParams,
  GetMemberInfoParams,
  GetReactionsParams,
  ListBotsParams,
  ListChannelsParams,
  ListPinsParams,
  ListPlatformsParams,
  ListThreadsParams,
  PinMessageParams,
  ReactToMessageParams,
  ReadMessagesParams,
  ReplyToThreadParams,
  SearchMessagesParams,
  SendDirectMessageParams,
  SendMessageParams,
  ToggleBotParams,
  UnpinMessageParams,
  UpdateBotParams,
} from '../types';
import { MessageApiName, MessageToolIdentifier } from '../types';

class MessageExecutor extends BaseExecutor<typeof MessageApiName> {
  readonly identifier = MessageToolIdentifier;
  protected readonly apiEnum = MessageApiName;

  private runtime: MessageExecutionRuntime;

  constructor(runtime: MessageExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  // ==================== Core Message Operations ====================

  sendMessage = async (
    params: SendMessageParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.sendMessage(params);
  };

  readMessages = async (
    params: ReadMessagesParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.readMessages(params);
  };

  editMessage = async (
    params: EditMessageParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.editMessage(params);
  };

  deleteMessage = async (
    params: DeleteMessageParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.deleteMessage(params);
  };

  searchMessages = async (
    params: SearchMessagesParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.searchMessages(params);
  };

  // ==================== Reactions ====================

  reactToMessage = async (
    params: ReactToMessageParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.reactToMessage(params);
  };

  getReactions = async (
    params: GetReactionsParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.getReactions(params);
  };

  // ==================== Pin Management ====================

  pinMessage = async (
    params: PinMessageParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.pinMessage(params);
  };

  unpinMessage = async (
    params: UnpinMessageParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.unpinMessage(params);
  };

  listPins = async (
    params: ListPinsParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.listPins(params);
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (
    params: GetChannelInfoParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.getChannelInfo(params);
  };

  listChannels = async (
    params: ListChannelsParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.listChannels(params);
  };

  // ==================== Member Information ====================

  getMemberInfo = async (
    params: GetMemberInfoParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.getMemberInfo(params);
  };

  // ==================== Thread Operations ====================

  createThread = async (
    params: CreateThreadParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.createThread(params);
  };

  listThreads = async (
    params: ListThreadsParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.listThreads(params);
  };

  replyToThread = async (
    params: ReplyToThreadParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.replyToThread(params);
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (
    params: CreatePollParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.createPoll(params);
  };

  // ==================== Direct Messaging ====================

  sendDirectMessage = async (
    params: SendDirectMessageParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.sendDirectMessage(params);
  };

  // ==================== Bot Management ====================

  listPlatforms = async (
    params: ListPlatformsParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.listPlatforms(params);
  };

  listBots = async (
    params: ListBotsParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.listBots(params);
  };

  getBotDetail = async (
    params: GetBotDetailParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.getBotDetail(params);
  };

  createBot = async (
    params: CreateBotParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.createBot(params);
  };

  updateBot = async (
    params: UpdateBotParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.updateBot(params);
  };

  deleteBot = async (
    params: DeleteBotParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.deleteBot(params);
  };

  toggleBot = async (
    params: ToggleBotParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.toggleBot(params);
  };

  connectBot = async (
    params: ConnectBotParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.connectBot(params);
  };
}

export { MessageExecutor };
