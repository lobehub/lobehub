import {
  createLarkAdapter,
  decodeLarkThreadId,
  downloadMediaFromRawMessage,
  LarkApiClient,
  type LarkRawMessage,
} from '@lobechat/chat-adapter-feishu';
import type { Chat as ChatBot, Message } from 'chat';
import debug from 'debug';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import { RECEIVED_REACTION_EMOJI, THINKING_REACTION_EMOJI, WORKING_REACTION_EMOJI } from '../const';
import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  messengerContentText,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { FeishuWSConnection } from './gateway';
import { sendFeishuAttachments } from './sendAttachments';

const log = debug('bot-platform:feishu:client');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface GatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

function extractChatId(platformThreadId: string): string {
  // Delegate to the adapter's shared decoder so this stays in sync with the
  // threadId format. New format is `lark:p2p:oc_xxx` / `lark:group:oc_xxx`,
  // legacy is `lark:oc_xxx` — naive `split(':')[1]` would return `'p2p'` /
  // `'group'` for the new format and break outbound API calls.
  return decodeLarkThreadId(platformThreadId).chatId;
}

/** Resolve the Lark/Feishu domain from the platform id. */
function resolveDomain(platform: string): 'lark' | 'feishu' {
  return platform === 'lark' ? 'lark' : 'feishu';
}

/** Fallback pre-injection window (seconds) when the caller passes no `sinceSec`. */
const GROUP_HISTORY_DEFAULT_WINDOW_SEC = 24 * 60 * 60;

/** Max pages when pulling a whole topic thread for a quoted reference. */
const REFERENCE_THREAD_MAX_PAGES = 4;

/**
 * Render one list/getMessage API item's text: restores `@_user_N` mention
 * placeholders to real display names (via the item's `mentions` array) and
 * replaces non-text bodies (`image` / `file` / …) with a named placeholder —
 * the content is downloaded elsewhere (resolveReference), history only labels.
 * A mention of the bot itself is dropped: the model doesn't know its own
 * display name, and "@智能机器人 …" in injected history is pure noise.
 */
function apiItemText(
  m: {
    body?: { content?: string };
    mentions?: Array<{ id?: { open_id?: string }; key: string; name?: string }>;
    msg_type?: string;
  },
  botOpenId?: string,
): string {
  if (m.msg_type && m.msg_type !== 'text' && m.msg_type !== 'post') {
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(m.body?.content ?? '');
    } catch {
      // keep {}
    }
    const fileName = typeof content.file_name === 'string' ? content.file_name : undefined;
    if (m.msg_type === 'image') return '[图片]';
    if (m.msg_type === 'file') return fileName ? `[文件: ${fileName}]` : '[文件]';
    if (m.msg_type === 'audio') return '[语音]';
    if (m.msg_type === 'media') return '[视频]';
    return `[${m.msg_type} 消息]`;
  }
  let text: string;
  try {
    text = JSON.parse(m.body?.content ?? '').text ?? '';
  } catch {
    text = m.body?.content ?? '';
  }
  const mentionNames = new Map<string, string>(
    (m.mentions ?? []).map((mention) => [
      mention.key,
      botOpenId && mention.id?.open_id === botOpenId ? '' : mention.name || '',
    ]),
  );
  return text.replaceAll(/(@_user_\d+|@_all)/g, (key) => {
    const name = mentionNames.get(key);
    return name ? `@${name}` : '';
  });
}

/** Per-api cache for the bot's own open_id (used to drop self-mentions). */
const botOpenIdCache = new WeakMap<LarkApiClient, Promise<string | undefined>>();

async function fetchBotOpenId(api: LarkApiClient): Promise<string | undefined> {
  let cached = botOpenIdCache.get(api);
  if (!cached) {
    cached = (async () => {
      try {
        return (await api.getBotInfo())?.open_id as string | undefined;
      } catch (error) {
        log('bot info fetch failed (non-fatal): %O', error);
        return undefined;
      }
    })();
    botOpenIdCache.set(api, cached);
  }
  return cached;
}

/** Max media items downloaded per pre-injection window. */
const GROUP_HISTORY_MAX_MEDIA = 3;

/**
 * Map the bot pipeline's status-emoji constants to Feishu reaction
 * `emoji_type` identifiers (see 表情文案说明 doc). Keyed by the same consts
 * the bridge uses, so a new status emoji here surfaces as a skipped reaction
 * (API rejects unknown types with 231001) instead of a silent mismatch.
 */
// Verified against the official 表情文案说明 table: 👀→Get (received/
// fetched), 🤔→THINKING, ⚡→OnIt (working on it).
const FEISHU_EMOJI_TYPES: Record<string, string> = {
  [RECEIVED_REACTION_EMOJI]: 'Get',
  [THINKING_REACTION_EMOJI]: 'THINKING',
  [WORKING_REACTION_EMOJI]: 'OnIt',
};

/**
 * list/getMessage API item shape (`msg_type` + `body.content`) → the webhook
 * shape (`message_type` + `content`) the download helper expects.
 */
function apiItemToWebhookShape(m: {
  body?: { content?: string };
  message_id?: string;
  msg_type?: string;
}) {
  return {
    content: m.body?.content ?? '',
    message_id: m.message_id,
    message_type: m.msg_type ?? 'text',
  };
}

/**
 * Download an API item's media as AttachmentSource. Returns undefined for
 * text/post bodies and failed downloads — callers degrade to placeholder text.
 */
async function downloadApiItemMedia(api: LarkApiClient, m: { msg_type?: string }) {
  if (!m.msg_type || m.msg_type === 'text' || m.msg_type === 'post') return undefined;
  try {
    const media = await downloadMediaFromRawMessage(api, apiItemToWebhookShape(m) as any);
    if (media.length === 0) return undefined;
    return media.map((att: any) => ({
      buffer: att.buffer,
      mimeType: att.mimeType,
      name: att.name,
      size: att.size,
    }));
  } catch (error) {
    log('media download failed for %s (non-fatal): %O', m.msg_type, error);
    return undefined;
  }
}

/**
 * Fetch recent human-authored group messages for context pre-injection.
 * Topic threads (`…:omt_xxx` platformThreadId) read from the thread container
 * so the injected history matches what the user sees in that topic; plain
 * groups read the chat container. Speaker names are resolved via getUserInfo
 * with a per-call cache (≤ limit distinct senders, usually 2-3). Returned
 * oldest-first; when the window holds more than `limit` messages only the
 * newest `limit` survive. Non-text content is skipped.
 *
 * Fetches with `sort_type=ByCreateTimeDesc` so page 1 IS the latest
 * `pageSize` messages (thread containers ignore `start_time`, so without desc
 * ordering an old topic would serve its 2024-era head instead of the recent
 * tail). Results are reversed back to chronological before returning.
 */
async function readRecentGroupMessages(
  api: LarkApiClient,
  platformThreadId: string,
  limit: number,
  options?: { excludeMessageId?: string; sinceSec?: number },
): Promise<{ author: string; text: string }[]> {
  const { chatId, threadId } = decodeLarkThreadId(platformThreadId);
  const containerId = threadId ?? chatId;
  const containerType = threadId ? 'thread' : 'chat';
  const sinceSec =
    options?.sinceSec ?? Math.floor(Date.now() / 1000) - GROUP_HISTORY_DEFAULT_WINDOW_SEC;
  // Fetch the API maximum newest-first; bot and pre-watermark messages are
  // filtered below, and thread containers ignore start_time.
  const res = await api.listMessages(containerId, {
    containerType,
    pageSize: 50,
    sortOrder: 'desc',
    startTime: containerType === 'chat' ? String(sinceSec) : undefined,
  });
  // API returns newest-first; reverse into chronological order for injection.
  const items = [...res.items].reverse();

  // The list API's `start_time` is IGNORED by the thread container (probed
  // 2026-08-20: identical result set with and without it) — filter by
  // `create_time` client-side so watermark-incremental injection doesn't
  // re-pull the whole thread tail on every wake-up. The list API returns
  // seconds; accept ms-shaped values defensively (webhook payloads use ms).
  const sinceMs = sinceSec * 1000;
  const itemTimeMs = (raw: unknown) => {
    const n = Number(raw);
    return n > 1e12 ? n : n * 1000;
  };
  const human = items.filter(
    (m) =>
      m.sender?.sender_type === 'user' &&
      m.body?.content &&
      m.message_id &&
      m.message_id !== options?.excludeMessageId &&
      itemTimeMs(m.create_time) >= sinceMs,
  );

  const nameCache = new Map<string, string>();
  const resolveName = async (openId: string): Promise<string> => {
    const cached = nameCache.get(openId);
    if (cached) return cached;
    try {
      const name = (await api.getUserInfo(openId))?.name || openId;
      nameCache.set(openId, name);
      return name;
    } catch {
      return openId;
    }
  };

  // `items` was reversed to chronological (oldest-first); keep the tail so the
  // injected block ends at the newest message. Media in
  // the window (image/file/… sent without @-mentioning the bot) is downloaded
  // (bounded) so the agent can actually read the content — text-only context
  // would leave "看看这个文件" unanswerable.
  const botOpenId = await fetchBotOpenId(api);
  const lines: { author: string; text: string; attachments?: AttachmentSource[] }[] = [];
  let mediaBudget = GROUP_HISTORY_MAX_MEDIA;
  for (const m of human.slice(-limit)) {
    const trimmed = apiItemText(m, botOpenId).trim();
    if (!trimmed) continue;
    const line: { author: string; text: string; attachments?: AttachmentSource[] } = {
      author: await resolveName(m.sender.id),
      text: trimmed,
    };
    if (mediaBudget > 0 && m.msg_type && m.msg_type !== 'text' && m.msg_type !== 'post') {
      const media = await downloadApiItemMedia(api, m);
      if (media) {
        line.attachments = media;
        mediaBudget -= 1;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Result of resolving a quoted/replied message for prompt injection. */
interface FeishuReferencedContext {
  /** Media carried by the quoted message, downloaded for the agent to read. */
  attachments?: AttachmentSource[];
  sender: string;
  /** Whole topic thread the quoted message lives in (topic groups only). */
  surrounding?: { author: string; text: string }[];
  text: string;
}

/**
 * Resolve the quoted/replied message of an inbound message (Feishu reply
 * carries `parent_id` on the raw webhook payload). Returns undefined when the
 * message isn't a reply or the parent fetch fails — callers degrade silently.
 *
 * Layer 1: the parent message itself (sender + text, mentions restored).
 * Layer 2: when the parent lives in a topic thread (`thread_id`), the WHOLE
 *   thread is pulled (ascending, up to REFERENCE_THREAD_MAX_PAGES × 50) as
 *   surrounding context — quoting an old topic and asking "summarize this"
 *   needs the full discussion, not just the quoted line.
 * Quoted media (image/file/audio) is downloaded via the same on-demand path
 * as direct attachments, so the agent can actually read the content.
 */
async function resolveFeishuReference(
  api: LarkApiClient,
  message: Message,
): Promise<FeishuReferencedContext | undefined> {
  const raw = (message as any).raw as { parent_id?: string } | undefined;
  const parentId = raw?.parent_id;
  if (!parentId) return undefined;

  // In feishu topic groups EVERY message replies to the topic root by
  // default, so a bare parent_id is NOT a deliberate quote. Treat the reply
  // as a quote only when the parent is a regular message (thread_id absent)
  // or an in-thread reply to a non-root message. The root's own quote —
  // otherwise re-injected on every turn — comes through the surrounding
  // pull below anyway.
  if (parentId === (raw as any).root_id || parentId === (raw as any).thread_id) return undefined;

  let fetched: any;
  try {
    fetched = await api.getMessage(parentId);
  } catch (error) {
    log('resolveReference: parent fetch failed (non-fatal): %O', error);
    return undefined;
  }
  const parent = fetched?.items?.[0] ?? fetched;
  if (!parent?.message_id) return undefined;

  const sender =
    parent.sender?.sender_type === 'user'
      ? ((await api.getUserInfo(parent.sender.id))?.name ?? parent.sender.id)
      : (parent.sender?.sender_type ?? 'unknown');

  // Quoted media rides the same on-demand download path as direct attachments.
  const attachments = await downloadApiItemMedia(api, parent);

  let surrounding: { author: string; text: string }[] | undefined;
  if (parent.thread_id) {
    try {
      // Exclude the triggering message (delivered below as the run's own user
      // prompt — injecting it here duplicates the current turn) and the quoted
      // parent itself (already rendered as the <referenced_message> block).
      const triggerMessageId = (message as any).raw?.message_id as string | undefined;
      const exclude = new Set([triggerMessageId, parentId].filter((id): id is string => !!id));
      const nameCache = new Map<string, string>();
      const resolveName = async (openId: string): Promise<string> => {
        const cached = nameCache.get(openId);
        if (cached) return cached;
        try {
          const name = (await api.getUserInfo(openId))?.name || openId;
          nameCache.set(openId, name);
          return name;
        } catch {
          return openId;
        }
      };
      const items: any[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < REFERENCE_THREAD_MAX_PAGES; page += 1) {
        const res = await api.listMessages(parent.thread_id, {
          containerType: 'thread',
          pageSize: 50,
          pageToken,
        });
        items.push(...res.items);
        if (!res.hasMore || !res.pageToken) break;
        pageToken = res.pageToken;
      }
      const botOpenId = await fetchBotOpenId(api);
      // Human messages only — the bot's OWN replies in the thread are the
      // conversation's own history (already persisted in the topic), so
      // re-injecting them duplicates every prior turn.
      const speakers = await Promise.all(
        items
          .filter((m) => m.sender?.sender_type === 'user' && !exclude.has(m.message_id))
          .map(async (m) => ({
            author: await resolveName(m.sender?.id ?? 'unknown'),
            text: apiItemText(m, botOpenId).trim(),
          })),
      );
      const lines = speakers.filter((line) => line.text);
      if (lines.length > 0) surrounding = lines;
    } catch (error) {
      log('resolveReference: thread pull failed (non-fatal): %O', error);
    }
  }

  return {
    sender,
    text: apiItemText(parent, await fetchBotOpenId(api)).trim(),
    surrounding,
    attachments,
  };
}

// ---------- Shared runtime operations ----------

function createMessenger(
  config: BotProviderConfig,
  domain: 'lark' | 'feishu',
  platformThreadId: string,
  opts?: { replyToMessageId?: string },
): PlatformMessenger {
  const api = new LarkApiClient(config.applicationId, config.credentials.appSecret, domain);
  const chatId = extractChatId(platformThreadId);
  // Reply-threaded messenger: every outbound message answers the triggering
  // message via `im/v1/messages/{id}/reply`, so it lands inside the trigger's
  // topic thread (Feishu topic groups) and renders as a quoted reply
  // elsewhere. `reply_in_thread` is not sent — default false attaches the
  // reply to the topic the trigger lives in without spawning a new one.
  const replyTo = opts?.replyToMessageId;
  return {
    addReaction: (messageId, emoji) => api.addReaction(messageId, emoji).then(() => {}),
    createMessage: async (content) => {
      const text = messengerContentText(content);
      const attachments = typeof content === 'string' ? undefined : content.attachments;
      // The id of the last message actually sent — lets the caller track the
      // reply as its progress-message handle for later edits.
      let lastMessageId: string | undefined;
      if (text.trim()) {
        // Card-only transport (lark_md): markdown renders natively; URL
        // images are downgraded to links because Feishu requires image_key.
        const sent = replyTo
          ? await api.replyCard(replyTo, text)
          : await api.sendCard(chatId, text);
        lastMessageId = sent.messageId;
      }
      if (attachments?.length) {
        const sentIds = await sendFeishuAttachments(api, chatId, attachments, replyTo);
        if (sentIds.length === 0) throw new Error('Feishu delivered no attachments');
        lastMessageId = sentIds.at(-1);
      }
      return lastMessageId ? { messageId: lastMessageId } : undefined;
    },
    editMessage: (messageId, content) =>
      api.editCard(messageId, messengerContentText(content)).then(() => {}),
    // Feishu / Lark currently expose no authenticated removeReaction endpoint.
    // Callers should treat this as a best-effort no-op — step swaps will stack
    // additions rather than clear the previous emoji.
    removeReaction: () => Promise.resolve(),
    replaceReaction: async (messageId, prevEmoji, nextEmoji) => {
      if (prevEmoji === nextEmoji) return;
      // No remove API upstream — we can only add. Step swaps therefore stack
      // emoji on the user's message. Final cleanup is a no-op.
      // Feishu reactions take an `emoji_type` identifier (EYES, THINKING…),
      // NOT the Unicode emoji other platforms use — map, and skip unknown
      // ones (API rejects invalid types with 231001).
      const type = FEISHU_EMOJI_TYPES[nextEmoji!];
      if (type) await api.addReaction(messageId, type);
    },
  };
}

/**
 * Resolve attachments on an inbound Feishu/Lark message into
 * `AttachmentSource[]`. Shared by both webhook and websocket clients.
 *
 * Why we re-download instead of trusting the in-message buffer or fetchData:
 * the chat-adapter-feishu used to set `fetchData` (sync `parseMessage` path)
 * or `buffer` (async `parseRawEvent` path) on attachments, but
 * `Message.toJSON` strips both whenever the message is enqueued (debounce
 * always; queue when busy). So whenever a message round-trips through the
 * queue, the in-memory data is gone and we have to re-fetch via the Lark
 * resource API ourselves. After the adapter refactor, attachments are now
 * metadata-only at parse time and `extractFiles` is the sole download path.
 *
 * The original `LarkRawMessage` (with `message_id` + `content` JSON
 * carrying `image_key` / `file_key` / etc.) IS preserved in `message.raw`
 * because `toJSON` keeps it intact. We hand that and a `LarkApiClient` to
 * the package-exported `downloadMediaFromRawMessage` helper.
 */
async function feishuExtractFiles(
  api: LarkApiClient,
  message: Message,
): Promise<AttachmentSource[] | undefined> {
  const raw = (message as any).raw as LarkRawMessage | undefined;
  // Merged messages (image sent first, @mention text after — see the router's
  // mergeSkippedMessages) carry EVERY constituent message's raw in `raws`;
  // a plain message just has its own `raw`. Download media from all of them.
  const raws = ((message as any).raws as LarkRawMessage[] | undefined) ?? (raw ? [raw] : []);
  if (raws.length === 0) return undefined;

  log('extractFiles: msgId=%s, raws=%d', (message as any).id, raws.length);

  const attachments: AttachmentSource[] = [];
  for (const item of raws) {
    try {
      const media = await downloadMediaFromRawMessage(api, item);
      attachments.push(
        ...media.map((att: any) => ({
          buffer: att.buffer,
          mimeType: att.mimeType,
          name: att.name,
          size: att.size,
        })),
      );
    } catch (error) {
      log(
        'extractFiles: media download failed for msgId=%s (non-fatal): %O',
        item.message_id,
        error,
      );
    }
  }
  if (attachments.length === 0) {
    log('extractFiles: no media items resolved for msgId=%s', (message as any).id);
    return undefined;
  }

  log(
    'extractFiles: resolved %d media item(s) for msgId=%s',
    attachments.length,
    (message as any).id,
  );

  return attachments;
}

// ---------- Webhook Client (existing behavior) ----------

class FeishuWebhookClient implements PlatformClient {
  readonly id: string;
  readonly applicationId: string;

  private config: BotProviderConfig;
  private domain: 'lark' | 'feishu';
  /** Lazy-cached LarkApiClient — keeps the tenant token cache hot across calls. */
  private _api?: LarkApiClient;

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.config = config;
    this.id = config.platform;
    this.applicationId = config.applicationId;
    this.domain = resolveDomain(config.platform);
  }

  private get api(): LarkApiClient {
    if (!this._api) {
      this._api = new LarkApiClient(
        this.config.applicationId,
        this.config.credentials.appSecret,
        this.domain,
      );
    }
    return this._api;
  }

  async start(): Promise<void> {
    log('Starting FeishuClient (webhook) appId=%s domain=%s', this.applicationId, this.domain);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      const api = new LarkApiClient(
        this.config.applicationId,
        this.config.credentials.appSecret,
        this.domain,
      );
      await api.getTenantAccessToken();

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log('FeishuClient (webhook) appId=%s credentials verified', this.applicationId);
    } catch (error) {
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        errorMessage: getRuntimeStatusErrorMessage(error),
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.failed,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    log('Stopping FeishuClient (webhook) appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  createAdapter(): Record<string, any> {
    return {
      [this.config.platform]: createLarkAdapter({
        appId: this.config.applicationId,
        appSecret: this.config.credentials.appSecret,
        encryptKey: this.config.credentials.encryptKey,
        platform: this.domain,
        verificationToken: this.config.credentials.verificationToken,
      }),
    };
  }

  getMessenger(platformThreadId: string, opts?: { replyToMessageId?: string }): PlatformMessenger {
    return createMessenger(this.config, this.domain, platformThreadId, opts);
  }

  async getUserInfo(platformUserId: string) {
    return this.api.getUserInfo(platformUserId);
  }

  readRecentMessages = (
    platformThreadId: string,
    limit: number,
    options?: { excludeMessageId?: string; sinceSec?: number },
  ) => readRecentGroupMessages(this.api, platformThreadId, limit, options);

  resolveReference = (message: Message) => resolveFeishuReference(this.api, message);

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return feishuExtractFiles(this.api, message);
  }

  extractChatId(platformThreadId: string): string {
    return extractChatId(platformThreadId);
  }

  formatMarkdown(markdown: string): string {
    // Pass-through: outbound is an interactive card whose `markdown` element
    // renders lark_md natively — stripping would corrupt links (e.g.
    // `![alt](url)` → `alt (url)` text, trailing paren glued to the URL).
    // Only the card size cap (30 KB) applies.
    return markdown;
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

// ---------- WebSocket Client (persistent, using Lark SDK WSClient) ----------

class FeishuWSClientImpl implements PlatformClient {
  readonly id: string;
  readonly applicationId: string;

  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private domain: 'lark' | 'feishu';
  private gateway: FeishuWSConnection | null = null;
  private bot: ChatBot<any> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Lazy-cached LarkApiClient — keeps the tenant token cache hot across calls. */
  private _api?: LarkApiClient;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.id = config.platform;
    this.applicationId = config.applicationId;
    this.domain = resolveDomain(config.platform);
  }

  private get api(): LarkApiClient {
    if (!this._api) {
      this._api = new LarkApiClient(
        this.config.applicationId,
        this.config.credentials.appSecret,
        this.domain,
      );
    }
    return this._api;
  }

  async start(options?: GatewayListenerOptions): Promise<void> {
    log('Starting FeishuClient (ws) appId=%s domain=%s', this.applicationId, this.domain);

    this.stopped = false;
    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const runtimeStatusTtlMs = durationMs + CONNECTED_STATUS_TTL_BUFFER_MS;
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.starting,
      },
      { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
    );

    try {
      if (this.bot) {
        await this.bot.shutdown().catch(() => {});
        this.bot = null;
      }

      const adapter = createLarkAdapter({
        appId: this.config.applicationId,
        appSecret: this.config.credentials.appSecret,
        encryptKey: this.config.credentials.encryptKey,
        platform: this.domain,
        verificationToken: this.config.credentials.verificationToken,
      });

      const { Chat, ConsoleLogger } = await import('chat');

      const chatConfig: any = {
        adapters: { [this.config.platform]: adapter },
        userName: `lobehub-gateway-${this.applicationId}`,
      };

      if (this.context.redisClient) {
        const { createIoRedisState } = await import('@chat-adapter/state-ioredis');
        chatConfig.state = createIoRedisState({
          client: this.context.redisClient as any,
          logger: new ConsoleLogger(),
        });
      }

      const bot = new Chat(chatConfig);
      this.bot = bot;
      await bot.initialize();

      const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/${this.config.platform}/${this.applicationId}`;

      this.gateway = new FeishuWSConnection({
        appId: this.config.applicationId,
        appSecret: this.config.credentials.appSecret,
        domain: this.domain,
        verificationToken: this.config.credentials.verificationToken,
        webhookUrl,
      });

      await this.gateway.start();

      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.stopped) return;

          log(
            'FeishuClient appId=%s duration elapsed (%dh), refreshing...',
            this.applicationId,
            durationMs / 3_600_000,
          );
          this.gateway?.close();
          this.start().catch((err) => {
            log('Failed to refresh FeishuClient appId=%s: %O', this.applicationId, err);
          });
        }, durationMs);
      }

      await updateBotRuntimeStatus(
        {
          applicationId: this.applicationId,
          platform: this.id,
          status: BOT_RUNTIME_STATUSES.connected,
        },
        { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
      );

      log('FeishuClient (ws) appId=%s started', this.applicationId);
    } catch (error) {
      await updateBotRuntimeStatus(
        {
          applicationId: this.applicationId,
          errorMessage: getRuntimeStatusErrorMessage(error),
          platform: this.id,
          status: BOT_RUNTIME_STATUSES.failed,
        },
        { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    log('Stopping FeishuClient (ws) appId=%s', this.applicationId);
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.gateway?.close();
    this.gateway = null;
    if (this.bot) {
      await this.bot.shutdown().catch(() => {});
      this.bot = null;
    }
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.disconnected,
      },
      { redisClient: this.context.redisClient as any },
    );
  }

  createAdapter(): Record<string, any> {
    return {
      [this.config.platform]: createLarkAdapter({
        appId: this.config.applicationId,
        appSecret: this.config.credentials.appSecret,
        encryptKey: this.config.credentials.encryptKey,
        platform: this.domain,
        verificationToken: this.config.credentials.verificationToken,
      }),
    };
  }

  getMessenger(platformThreadId: string, opts?: { replyToMessageId?: string }): PlatformMessenger {
    return createMessenger(this.config, this.domain, platformThreadId, opts);
  }

  async getUserInfo(platformUserId: string) {
    return this.api.getUserInfo(platformUserId);
  }

  readRecentMessages = (
    platformThreadId: string,
    limit: number,
    options?: { excludeMessageId?: string; sinceSec?: number },
  ) => readRecentGroupMessages(this.api, platformThreadId, limit, options);

  resolveReference = (message: Message) => resolveFeishuReference(this.api, message);

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return feishuExtractFiles(this.api, message);
  }

  extractChatId(platformThreadId: string): string {
    return extractChatId(platformThreadId);
  }

  formatMarkdown(markdown: string): string {
    // Pass-through: outbound is an interactive card whose `markdown` element
    // renders lark_md natively — stripping would corrupt links (e.g.
    // `![alt](url)` → `alt (url)` text, trailing paren glued to the URL).
    // Only the card size cap (30 KB) applies.
    return markdown;
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

// ---------- Factory ----------

export class FeishuClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    // Fall back to 'webhook' to preserve behavior for legacy provider rows
    // that pre-date the connectionMode field. New providers always go through
    // the form which seeds connectionMode from the schema default.
    const mode = (config.settings?.connectionMode as string) || 'webhook';
    if (mode === 'websocket') {
      return new FeishuWSClientImpl(config, context);
    }
    return new FeishuWebhookClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
    platform?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!applicationId) errors.push({ field: 'applicationId', message: 'App ID is required' });
    if (!credentials.appSecret)
      errors.push({ field: 'appSecret', message: 'App Secret is required' });

    if (errors.length > 0) return { errors, valid: false };

    try {
      const domain = resolveDomain(platform || 'feishu');
      const api = new LarkApiClient(applicationId!, credentials.appSecret, domain);
      await api.getTenantAccessToken();
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'credentials', message: 'Failed to authenticate with Feishu API' }],
        valid: false,
      };
    }
  }
}
