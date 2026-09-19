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
  ReadDocumentParams,
  ReadDocumentState,
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
import type { LarkApiClient, LarkDocLink } from '@lobechat/chat-adapter-feishu';
import {
  flattenLarkMessageContent,
  parseLarkDocUrl,
  supportedFeishuEmojiTypes,
  toFeishuEmojiType,
} from '@lobechat/chat-adapter-feishu';
import { DEFAULT_BOT_HISTORY_LIMIT } from '@lobechat/const';

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

import { MAX_FEISHU_DOCUMENT_CHARS, MAX_FEISHU_HISTORY_LIMIT } from './const';
import { sendFeishuAttachments } from './sendAttachments';

/**
 * Feishu/Lark error codes that make a history read fail for a *configuration*
 * reason rather than a transient one, mapped to the action that fixes them.
 *
 * `LarkApiClient` surfaces failures as `Lark API GET /im/v1/messages failed:
 * 230027 Permission denied` — accurate but useless to the model, which then
 * relays a bare code to the user. `im:message.group_msg` in particular is easy
 * to miss: it's needed *on top of* `im:message:readonly` for group history, so
 * a bot that sends and receives fine still can't read the backlog.
 *
 * See `protocol-spec.md` §4.5.
 */
const HISTORY_READ_ERROR_HINTS: Record<string, string> = {
  '230002': 'the bot is not a member of this chat — add it to the group first',
  '230006':
    'the bot capability is not enabled for this app — enable it in the Feishu/Lark developer console',
  // Name the scope the way the console lists it. The console's permission
  // search matches the Chinese display name, so a bare code sends the operator
  // hunting; and the neighbouring `im:message.group_msg.include_bot:read`
  // ("获取群组中用户和机器人发送的消息") is a different scope that governs the
  // receive-message event, not history reads — easy to grab by mistake.
  '230027':
    'the app lacks permission to read this chat history. Reading GROUP history requires the scope "获取群组中所有消息" (`im:message.group_msg`) IN ADDITION TO `im:message:readonly` — add it under 权限管理 in the developer console (it is 免审, but you must then 创建版本 and 发布 for it to take effect). Note this is not `im:message.group_msg.include_bot:read`, which only governs the receive-message event',
  '230073': 'this topic is not visible to the bot',
};

/**
 * Turn a raw Lark API failure into a message the model can act on, leaving
 * anything unrecognized untouched so genuine/unknown errors stay debuggable.
 */
const explainHistoryReadError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  const code = Object.keys(HISTORY_READ_ERROR_HINTS).find((c) => message.includes(c));
  if (!code) return error instanceof Error ? error : new Error(message);
  return new Error(`${message} — ${HISTORY_READ_ERROR_HINTS[code]}.`);
};

/**
 * Normalize a Feishu/Lark message object to MessageItem.
 */
const toMessageItem = (msg: any): MessageItem => {
  // History rows carry `msg_type` (receive events say `message_type`). Only
  // `text` bodies are a plain string; rich text and cards — which is how
  // meeting minutes and other documents land in a chat — are flattened so
  // the model sees their text AND the document links, instead of ''.
  const { text: content } = flattenLarkMessageContent(
    msg.msg_type ?? msg.message_type,
    msg.body?.content ?? '{}',
  );

  return {
    author: {
      id: msg.sender?.id ?? '',
      name: msg.sender?.sender_type === 'user' ? (msg.sender?.id ?? 'User') : 'Bot',
    },
    content,
    id: msg.message_id ?? '',
    replyTo: msg.parent_id ?? msg.root_id ?? undefined,
    timestamp: msg.create_time
      ? new Date(Number(msg.create_time)).toISOString()
      : new Date().toISOString(),
  };
};

/**
 * Docx API failures that have a fix on the operator's side, mapped to that
 * fix. Scope violations are already spelled out by `LarkApiClient`
 * (`permission_violations`), so this table only covers the codes where the
 * bare message is misleading — notably `1770032`, which reads as a scope
 * problem but usually means the *document* is not visible to the app.
 *
 * @see https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content
 */
const DOCUMENT_READ_ERROR_HINTS: Record<string, string> = {
  '1770001': 'the document token is malformed — pass the URL exactly as it appears in the chat',
  '1770002': 'the document does not exist (or the token belongs to a different tenant)',
  '1770003': 'the document has been deleted',
  '1770032':
    'the app cannot see this document. Sharing it into a group the bot is in does not grant access — the owner must add the app as a collaborator (文档「分享」→ 添加协作者 → 搜索应用名), or the space/folder must grant the app access. If the app also lacks the scope, enable `docx:document:readonly` under 权限管理 and re-publish the app',
};

const explainDocumentReadError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  const code = Object.keys(DOCUMENT_READ_ERROR_HINTS).find((c) => message.includes(c));
  if (!code) return error instanceof Error ? error : new Error(message);
  return new Error(`${message} — ${DOCUMENT_READ_ERROR_HINTS[code]}.`);
};

/**
 * What a `readDocument` call points at. A bare `documentId` is assumed to be
 * a docx token — that is what every other docx endpoint takes and what the
 * model gets back in `ReadDocumentState.documentId`.
 */
const resolveDocumentTarget = (
  params: ReadDocumentParams,
): Pick<LarkDocLink, 'kind' | 'token'> & { url?: string } => {
  if (params.url) {
    const link = parseLarkDocUrl(params.url);
    if (!link) {
      throw new Error(
        `"${params.url}" is not a Feishu/Lark document link. Expected https://<tenant>.feishu.cn/docx/<token> (or /wiki/, /docs/ …)`,
      );
    }
    return link;
  }
  if (params.documentId) return { kind: 'docx', token: params.documentId };
  throw new Error('readDocument needs the document `url` (preferred) or its `documentId`');
};

const UNREADABLE_KIND_HINTS: Partial<Record<LarkDocLink['kind'], string>> = {
  base: 'this is a Bitable (多维表格) link; only docx documents and wiki pages wrapping them can be read',
  doc: 'this is a legacy /docs/ document; the docx API cannot read it — ask the owner to upgrade it to the new docx format (文档右上角「升级」) or share a docx link',
  file: 'this is a drive file link, not a document — ask for the docx link',
  minutes:
    'this is a Feishu Minutes (妙记) link; reading its transcript needs the `minutes:minutes` scope and a dedicated API that is not wired up yet. Meeting minutes shared as docx (智能纪要) can be read',
  sheets:
    'this is a spreadsheet link; only docx documents and wiki pages wrapping them can be read',
  slides: 'this is a slides link; only docx documents and wiki pages wrapping them can be read',
};

export class FeishuMessageService implements MessageRuntimeService {
  private platformName: string;

  constructor(
    private api: LarkApiClient,
    platformName: 'feishu' | 'lark' = 'feishu',
  ) {
    this.platformName = platformName;
  }

  // ==================== Core Message Operations ====================

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    // Lark/Feishu has no composite "text + media" message, so the text leg
    // ships first (so the user reads context before media) and each
    // attachment becomes its own follow-up message.
    let messageId: string | undefined;
    if (params.content?.trim()) {
      const result = await this.api.sendMessage(params.channelId, params.content);
      messageId = result.messageId;
    }
    if (params.attachments?.length) {
      await sendFeishuAttachments(this.api, params.channelId, params.attachments);
    }
    return {
      channelId: params.channelId,
      messageId,
      platform: this.platformName,
    };
  };

  readMessages = async (params: ReadMessagesParams): Promise<ReadMessagesState> => {
    // Feishu defaults to `ByCreateTimeAsc`, so an unsorted first page is the
    // OLDEST messages in the chat — in any group past the 50-message cap the
    // model would get the chat's beginnings instead of what was just said.
    // Ask for newest-first, then flip the page so the tool's documented
    // chronological order holds within the window. The same `sortType` goes on
    // every cursor follow-up because Feishu requires it to stay constant.
    const result = await this.api
      .listMessages(params.channelId, {
        endTime: params.endTime,
        pageSize: Math.min(params.limit ?? DEFAULT_BOT_HISTORY_LIMIT, MAX_FEISHU_HISTORY_LIMIT),
        pageToken: params.cursor,
        sortType: 'ByCreateTimeDesc',
        startTime: params.startTime,
      })
      .catch((error) => {
        throw explainHistoryReadError(error);
      });
    const messages = result.items.map(toMessageItem).reverse();
    return {
      channelId: params.channelId,
      hasMore: result.hasMore,
      messages,
      nextCursor: result.pageToken,
      platform: this.platformName,
      totalFetched: messages.length,
    };
  };

  /**
   * Read a docx document (or the docx a wiki node wraps) as plain text.
   * Reads use the app's own tenant token, so the document has to be
   * visible to the *app* — see `DOCUMENT_READ_ERROR_HINTS['1770032']`.
   */
  readDocument = async (params: ReadDocumentParams): Promise<ReadDocumentState> => {
    const target = resolveDocumentTarget(params);

    const kindHint = UNREADABLE_KIND_HINTS[target.kind];
    if (kindHint) throw new Error(`Cannot read ${target.url ?? target.token}: ${kindHint}.`);

    let documentId = target.token;
    let wikiTitle: string | undefined;
    if (target.kind === 'wiki') {
      // A wiki URL names a tree node; the docx endpoints want the object
      // behind it. Resolving needs `wiki:wiki:readonly` on top of the docx scope.
      const node = await this.api.getWikiNode(target.token).catch((error) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} — resolving a wiki link needs the \`wiki:wiki:readonly\` scope and the app must have access to that knowledge space.`,
        );
      });
      if (node.objType !== 'docx' || !node.objToken) {
        throw new Error(
          `Wiki node ${target.token} wraps a "${node.objType ?? 'unknown'}" object; only docx pages can be read.`,
        );
      }
      documentId = node.objToken;
      wikiTitle = node.title;
    }

    const rawContent = await this.api.getDocxRawContent(documentId).catch((error) => {
      throw explainDocumentReadError(error);
    });
    // Title is nice-to-have: if the metadata call fails after the body
    // succeeded, still return the body rather than the whole read failing.
    const meta = await this.api.getDocxDocument(documentId).catch(() => undefined);

    const truncated = rawContent.length > MAX_FEISHU_DOCUMENT_CHARS;
    return {
      content: truncated ? rawContent.slice(0, MAX_FEISHU_DOCUMENT_CHARS) : rawContent,
      documentId,
      kind: target.kind,
      platform: this.platformName,
      title: meta?.title ?? wikiTitle,
      truncated,
      url: target.url,
    };
  };

  editMessage = async (params: EditMessageParams): Promise<EditMessageState> => {
    await this.api.editMessage(params.messageId, params.content);
    return { messageId: params.messageId, success: true };
  };

  deleteMessage = async (params: DeleteMessageParams): Promise<DeleteMessageState> => {
    await this.api.deleteMessage(params.messageId);
    return { messageId: params.messageId, success: true };
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError(this.platformName, 'searchMessages');
  };

  // ==================== Reactions ====================

  reactToMessage = async (params: ReactToMessageParams): Promise<ReactToMessageState> => {
    // The tool schema asks for unicode because every other platform takes it;
    // Feishu takes a named `emoji_type` (see `./reactionEmoji`). Unlike the
    // bridge's fire-and-forget progress reactions, a tool call must not fail
    // silently — tell the model which names exist so it can pick another.
    const emojiType = toFeishuEmojiType(params.emoji);
    if (!emojiType) {
      throw new Error(
        `${this.platformName} has no reaction matching "${params.emoji}". ` +
          `It accepts a fixed emoji set, named rather than unicode: ${supportedFeishuEmojiTypes().join(', ')}.`,
      );
    }
    await this.api.addReaction(params.messageId, emojiType);
    return { messageId: params.messageId, success: true };
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError(this.platformName, 'getReactions');
  };

  // ==================== Pin Management ====================

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError(this.platformName, 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError(this.platformName, 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError(this.platformName, 'listPins');
  };

  // ==================== Channel Management ====================

  getChannelInfo = async (params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    const chat = await this.api.getChatInfo(params.channelId);
    return {
      description: chat.description ?? undefined,
      id: params.channelId,
      memberCount: chat.user_count ?? undefined,
      name: chat.name ?? undefined,
      type: chat.chat_mode ?? 'group',
    };
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError(this.platformName, 'listChannels');
  };

  // ==================== Member Information ====================

  getMemberInfo = async (params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    const user = await this.api.getUserInfo(params.memberId);
    return {
      displayName: user?.name ?? undefined,
      id: params.memberId,
      username: user?.name ?? undefined,
    };
  };

  // ==================== Thread Operations ====================

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError(this.platformName, 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError(this.platformName, 'listThreads');
  };

  replyToThread = async (params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    const result = await this.api.replyMessage(params.threadId, params.content);
    return { messageId: result.messageId, threadId: params.threadId };
  };

  // ==================== Platform-Specific: Polls ====================

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError(this.platformName, 'createPoll');
  };
}
