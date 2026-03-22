import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import type { MessageExecutionRuntime } from '../ExecutionRuntime';
import { MessageToolIdentifier } from '../types';
import { MessageApiName } from '../types';
import type {
  CreatePollParams,
  CreateThreadParams,
  DeleteMessageParams,
  EditMessageParams,
  GetChannelInfoParams,
  GetMemberInfoParams,
  GetReactionsParams,
  ListChannelsParams,
  ListPinsParams,
  ListThreadsParams,
  PinMessageParams,
  ReactToMessageParams,
  ReadMessagesParams,
  ReplyToThreadParams,
  SearchMessagesParams,
  SendMessageParams,
  UnpinMessageParams,
} from '../types';

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
}

export { MessageExecutor };
