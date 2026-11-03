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
  MessageItem,
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
import type {
  BlueBubblesChat,
  BlueBubblesMessage,
  BlueBubblesOutboundAttachment,
  BlueBubblesQueryResult,
} from '@lobechat/chat-adapter-imessage';
import { resolveAttachmentName } from '@lobechat/chat-adapter-imessage';

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

function authorFromMessage(message: BlueBubblesMessage): MessageItem['author'] {
  if (message.isFromMe) return { id: 'me', name: 'me' };

  const handle = message.handle;
  const id =
    handle?.address ||
    handle?.uncanonicalizedId ||
    String(message.handleId ?? message.otherHandle ?? 'unknown');
  return { id, name: id };
}

function messageToItem(message: BlueBubblesMessage): MessageItem {
  return {
    attachments: (message.attachments ?? []).map((attachment) => ({
      name: resolveAttachmentName(attachment),
      url: `bluebubbles:attachment:${attachment.guid}`,
    })),
    author: authorFromMessage(message),
    content: message.text ?? message.subject ?? '',
    id: message.guid,
    timestamp: new Date(message.dateCreated ?? Date.now()).toISOString(),
  };
}

function chatName(chat: BlueBubblesChat): string {
  return chat.displayName || chat.chatIdentifier || chat.guid;
}

interface ImessageMessageApi {
  getChat: (guid: string, withParts?: string[]) => Promise<BlueBubblesChat>;
  getChatMessages: (
    chatGuid: string,
    options?: {
      after?: number | string;
      before?: number | string;
      limit?: number;
      offset?: number;
      sort?: 'ASC' | 'DESC';
      withParts?: string[];
    },
  ) => Promise<BlueBubblesQueryResult<BlueBubblesMessage>>;
  queryChats: (body: Record<string, unknown>) => Promise<BlueBubblesQueryResult<BlueBubblesChat>>;
  queryMessages: (
    body: Record<string, unknown>,
  ) => Promise<BlueBubblesQueryResult<BlueBubblesMessage>>;
  sendAttachment: (
    chatGuid: string,
    attachment: BlueBubblesOutboundAttachment,
  ) => Promise<BlueBubblesMessage>;
  sendText: (chatGuid: string, message: string) => Promise<BlueBubblesMessage>;
}

/**
 * iMessage message-tool adapter backed by BlueBubbles.
 *
 * The `channelId` accepted by Message tools is the BlueBubbles `chatGuid`
 * (also exposed as `imessage:<chatGuid>` in inbound bot thread IDs).
 */
export class ImessageMessageService implements MessageRuntimeService {
  constructor(private api: ImessageMessageApi) {}

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    let lastMessage: BlueBubblesMessage | undefined;

    if (params.content?.trim()) {
      lastMessage = await this.api.sendText(params.channelId, params.content);
    }

    for (const attachment of params.attachments ?? []) {
      lastMessage = await this.api.sendAttachment(params.channelId, {
        data: attachment.data,
        fetchUrl: attachment.fetchUrl,
        mimeType: attachment.mimeType,
        name: attachment.name,
      });
    }

    return {
      channelId: params.channelId,
      messageId: lastMessage?.guid ?? lastMessage?.tempGuid,
      platform: 'imessage',
    };
  };

  readMessages = async (params: ReadMessagesParams): Promise<ReadMessagesState> => {
    const result = await this.api.getChatMessages(params.channelId, {
      after: params.after,
      before: params.before,
      limit: params.limit ?? 25,
      sort: 'DESC',
      withParts: ['attachments'],
    });

    return {
      channelId: params.channelId,
      messages: result.data.map(messageToItem).reverse(),
      platform: 'imessage',
      totalFetched: result.data.length,
    };
  };

  editMessage = async (_params: EditMessageParams): Promise<EditMessageState> => {
    throw new PlatformUnsupportedError('iMessage', 'editMessage');
  };

  deleteMessage = async (_params: DeleteMessageParams): Promise<DeleteMessageState> => {
    throw new PlatformUnsupportedError('iMessage', 'deleteMessage');
  };

  searchMessages = async (params: SearchMessagesParams): Promise<SearchMessagesState> => {
    const result = await this.api.queryMessages({
      chatGuid: params.channelId,
      limit: params.limit ?? 25,
      sort: 'DESC',
      where: [
        {
          args: { query: `%${params.query}%` },
          statement: 'message.text LIKE :query COLLATE NOCASE',
        },
      ],
      with: ['attachments'],
    });

    const authorId = params.authorId?.trim();
    const filtered = authorId
      ? result.data.filter((message) => authorFromMessage(message).id === authorId)
      : result.data;

    return {
      messages: filtered.map(messageToItem),
      query: params.query,
      totalFound: authorId ? filtered.length : (result.metadata?.total ?? filtered.length),
    };
  };

  reactToMessage = async (_params: ReactToMessageParams): Promise<ReactToMessageState> => {
    throw new PlatformUnsupportedError('iMessage', 'reactToMessage');
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError('iMessage', 'getReactions');
  };

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError('iMessage', 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError('iMessage', 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError('iMessage', 'listPins');
  };

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    const chat = await this.api.getChat(params.channelId, ['participants']);
    return {
      id: chat.guid,
      memberCount: chat.participants?.length,
      name: chatName(chat),
      type: chat.style === 43 ? 'group' : 'direct',
    };
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    const result = await this.api.queryChats({
      limit: 100,
      sort: 'lastmessage',
      with: ['lastmessage'],
    });

    return {
      channels: result.data.map((chat) => ({
        id: chat.guid,
        name: chatName(chat),
        type: chat.style === 43 ? 'group' : 'direct',
      })),
    };
  };

  getMemberInfo = async (_params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    throw new PlatformUnsupportedError('iMessage', 'getMemberInfo');
  };

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError('iMessage', 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError('iMessage', 'listThreads');
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    const result = await this.sendMessage({
      attachments: params.attachments,
      channelId: params.threadId,
      content: params.content,
      platform: 'imessage',
    });
    return { messageId: result.messageId, threadId: params.threadId };
  };

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError('iMessage', 'createPoll');
  };
}
