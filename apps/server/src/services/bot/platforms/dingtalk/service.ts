import type {
  CreatePollParams,
  CreatePollState,
  CreateThreadParams,
  CreateThreadState,
  DeleteMessageParams,
  DeleteMessageState,
  EditMessageParams,
  EditMessageState,
  GetChannelInfoParams,
  GetChannelInfoState,
  GetMemberInfoParams,
  GetMemberInfoState,
  GetReactionsParams,
  GetReactionsState,
  ListChannelsParams,
  ListChannelsState,
  ListPinsParams,
  ListPinsState,
  ListThreadsParams,
  ListThreadsState,
  PinMessageParams,
  PinMessageState,
  ReactToMessageParams,
  ReactToMessageState,
  ReadMessagesParams,
  ReadMessagesState,
  ReplyToThreadParams,
  ReplyToThreadState,
  SearchMessagesParams,
  SearchMessagesState,
  SendMessageParams,
  SendMessageState,
  UnpinMessageParams,
  UnpinMessageState,
} from '@lobechat/builtin-tool-message/executionRuntime';
import type { DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

import {
  attachmentDeliveryState,
  type AttachmentSendResult,
  warnAttachmentFailures,
} from '../attachmentDelivery';
import { sendDingTalkText } from './send';
import { sendDingTalkAttachments } from './sendAttachments';
import { formatDingTalkThreadId, parseDingTalkChannelId } from './threadId';

/**
 * `lobe-message` runtime for DingTalk robots.
 *
 * Only `sendMessage` is possible: DingTalk robots have no history, search,
 * edit, reaction, pin, member or channel-listing API (protocol-spec §6.5).
 * Every other op throws `PlatformUnsupportedError`, and
 * `PLATFORM_UNSUPPORTED_MESSAGE_APIS.dingtalk` lists them so the model is
 * never offered them.
 *
 * `channelId` is a DingTalk conversation: `group:<openConversationId>`,
 * `single:<staffId>`, a full `dingtalk:<type>:<id>` thread id, or a bare
 * `openConversationId` (treated as a group).
 */
export class DingTalkMessageService implements MessageRuntimeService {
  constructor(
    private api: DingTalkApiClient,
    private applicationId: string,
  ) {}

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    const conversation = parseDingTalkChannelId(params.channelId);
    let messageId: string | undefined;
    let attachments: AttachmentSendResult | undefined;
    if (params.attachments?.length) {
      attachments = await sendDingTalkAttachments(
        this.api,
        this.applicationId,
        conversation,
        params.attachments,
        params.content,
      );
      warnAttachmentFailures('bot-platform:dingtalk:sendMessage', attachments.failures);
    } else {
      messageId = await sendDingTalkText(
        this.api,
        this.applicationId,
        conversation,
        params.content,
      );
    }
    return {
      channelId: formatDingTalkThreadId(conversation),
      messageId,
      platform: 'dingtalk',
      ...attachmentDeliveryState(attachments),
    };
  };

  readMessages = async (_params: ReadMessagesParams): Promise<ReadMessagesState> => {
    throw new PlatformUnsupportedError('DingTalk', 'readMessages');
  };

  editMessage = async (_params: EditMessageParams): Promise<EditMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'editMessage');
  };

  deleteMessage = async (_params: DeleteMessageParams): Promise<DeleteMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'deleteMessage');
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError('DingTalk', 'searchMessages');
  };

  reactToMessage = async (_params: ReactToMessageParams): Promise<ReactToMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'reactToMessage');
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError('DingTalk', 'getReactions');
  };

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError('DingTalk', 'listPins');
  };

  getChannelInfo = async (_params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    throw new PlatformUnsupportedError('DingTalk', 'getChannelInfo');
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError('DingTalk', 'listChannels');
  };

  getMemberInfo = async (_params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    throw new PlatformUnsupportedError('DingTalk', 'getMemberInfo');
  };

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError('DingTalk', 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError('DingTalk', 'listThreads');
  };

  replyToThread = async (_params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    throw new PlatformUnsupportedError('DingTalk', 'replyToThread');
  };

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError('DingTalk', 'createPoll');
  };
}
