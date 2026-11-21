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

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

import {
  type BotWebhookCallbackTarget,
  newOutboundMessageId,
  sendBotWebhookEvent,
} from './callback';
import { toOutboundMessage } from './outbound';
import { BOT_WEBHOOK_OUTBOUND_EVENTS, WEBHOOK_PLATFORM_ID } from './protocol';

const PLATFORM_NAME = 'Custom Webhook';

/**
 * `lobe-message` runtime for a custom webhook bot. The protocol only carries messages
 * out, so `sendMessage` is the one operation: it POSTs a signed `bot.message.created`
 * event to the callback URL. `channelId` is a conversation id, or a full
 * `webhook:<direct|group>:…` thread id to target a sub-thread.
 */
export class WebhookMessageService implements MessageRuntimeService {
  constructor(private target: BotWebhookCallbackTarget) {}

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    const messageId = newOutboundMessageId();
    await sendBotWebhookEvent(
      this.target,
      BOT_WEBHOOK_OUTBOUND_EVENTS.messageCreated,
      toOutboundMessage(
        params.channelId,
        messageId,
        { attachments: params.attachments, content: params.content },
        params.replyTo ?? null,
      ),
    );
    return { channelId: params.channelId, messageId, platform: WEBHOOK_PLATFORM_ID };
  };

  readMessages = async (_params: ReadMessagesParams): Promise<ReadMessagesState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'readMessages');
  };

  editMessage = async (_params: EditMessageParams): Promise<EditMessageState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'editMessage');
  };

  deleteMessage = async (_params: DeleteMessageParams): Promise<DeleteMessageState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'deleteMessage');
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'searchMessages');
  };

  reactToMessage = async (_params: ReactToMessageParams): Promise<ReactToMessageState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'reactToMessage');
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'getReactions');
  };

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'listPins');
  };

  getChannelInfo = async (_params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'getChannelInfo');
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'listChannels');
  };

  getMemberInfo = async (_params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'getMemberInfo');
  };

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'listThreads');
  };

  replyToThread = async (_params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'replyToThread');
  };

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError(PLATFORM_NAME, 'createPoll');
  };
}
