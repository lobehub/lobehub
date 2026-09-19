const BASE_URLS: Record<string, string> = {
  feishu: 'https://open.feishu.cn/open-apis',
  lark: 'https://open.larksuite.com/open-apis',
};

const MAX_TEXT_LENGTH = 4000;

/**
 * `LARK_API_BASE_URL` redirects every call (auth included) to a stand-in Open
 * API — the seam a local acceptance run uses to drive the real client without
 * a Feishu tenant. Unset in production, where the platform picks the host.
 */
const resolveBaseUrl = (platform: string): string => {
  const override =
    typeof process === 'undefined' ? undefined : process.env?.LARK_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, '');
  return BASE_URLS[platform] || BASE_URLS.lark;
};

/**
 * Lightweight wrapper around the Lark/Feishu Open API.
 *
 * Auth: app_id + app_secret -> tenant_access_token (cached, auto-refreshed).
 */
export class LarkApiClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;

  private cachedToken?: string;
  private tokenExpiresAt = 0;

  constructor(appId: string, appSecret: string, platform: string = 'lark') {
    this.appId = appId;
    this.appSecret = appSecret;
    this.baseUrl = resolveBaseUrl(platform);
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async sendMessage(chatId: string, text: string): Promise<{ messageId: string; raw: any }> {
    const data = await this.call('POST', '/im/v1/messages?receive_id_type=chat_id', {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
      receive_id: chatId,
    });
    return { messageId: data.data.message_id, raw: data.data };
  }

  async editMessage(messageId: string, text: string): Promise<{ raw: any }> {
    const data = await this.call('PUT', `/im/v1/messages/${messageId}`, {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
    });
    return { raw: data.data };
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.call('DELETE', `/im/v1/messages/${messageId}`, {});
  }

  async getMessage(messageId: string): Promise<any> {
    const data = await this.call('GET', `/im/v1/messages/${messageId}`, {});
    return data.data;
  }

  /**
   * List messages in a chat.
   *
   * `sortType` defaults to `ByCreateTimeAsc` on Feishu's side, i.e. the FIRST
   * page is the OLDEST messages in the chat. A caller that wants "what was
   * just discussed" must ask for `ByCreateTimeDesc` — and keep passing the
   * same value on every `pageToken` follow-up, which Feishu requires.
   */
  async listMessages(
    chatId: string,
    options?: {
      pageSize?: number;
      pageToken?: string;
      sortType?: 'ByCreateTimeAsc' | 'ByCreateTimeDesc';
      startTime?: string;
      endTime?: string;
    },
  ): Promise<{ items: any[]; hasMore: boolean; pageToken?: string }> {
    const params = new URLSearchParams({ container_id_type: 'chat', container_id: chatId });
    if (options?.pageSize) params.set('page_size', String(options.pageSize));
    if (options?.pageToken) params.set('page_token', options.pageToken);
    if (options?.sortType) params.set('sort_type', options.sortType);
    if (options?.startTime) params.set('start_time', options.startTime);
    if (options?.endTime) params.set('end_time', options.endTime);

    const data = await this.call('GET', `/im/v1/messages?${params.toString()}`, {});
    return {
      hasMore: data.data.has_more,
      items: data.data.items || [],
      pageToken: data.data.page_token,
    };
  }

  async replyMessage(messageId: string, text: string): Promise<{ messageId: string; raw: any }> {
    const data = await this.call('POST', `/im/v1/messages/${messageId}/reply`, {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
    });
    return { messageId: data.data.message_id, raw: data.data };
  }

  /**
   * Add a reaction. Returns the `reaction_id` the delete endpoint needs —
   * it is only ever handed out here, so a caller that intends to remove its
   * own reaction later has to keep it.
   */
  async addReaction(messageId: string, emojiType: string): Promise<{ reactionId: string }> {
    const data = await this.call('POST', `/im/v1/messages/${messageId}/reactions`, {
      reaction_type: { emoji_type: emojiType },
    });
    return { reactionId: data.data?.reaction_id };
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.call('DELETE', `/im/v1/messages/${messageId}/reactions/${reactionId}`, {});
  }

  // ------------------------------------------------------------------
  // Chat info
  // ------------------------------------------------------------------

  async getChatInfo(chatId: string): Promise<any> {
    const data = await this.call('GET', `/im/v1/chats/${chatId}`, {});
    return data.data;
  }

  async getBotInfo(): Promise<any> {
    const data = await this.call('GET', '/bot/v3/info', {});
    return data.bot;
  }

  /**
   * Resolve the `open_id` of the human who owns this Feishu / Lark app.
   *
   * Why this exists: an `open_id` is scoped to a single application, so no
   * console page can ever show a person their own id for THIS bot — the only
   * other way to learn it is to message the bot and read the sender id back.
   * For a self-built app the platform does know one relevant human, the app's
   * owner (and, separately, its creator), which is normally the same person
   * configuring the channel.
   *
   * The call authenticates with the app's own tenant token, so the id that
   * comes back is already scoped to this app — the exact value inbound
   * webhooks carry as `sender_id.open_id`.
   *
   * Needs `application:application:self_manage` (already part of the
   * documented Batch Import scope list) or `admin:app.info:readonly`. `lang`
   * is a required query parameter; the value only selects the language of the
   * human-readable fields, which we ignore.
   *
   * @see https://open.feishu.cn/document/server-docs/application-v6/application/get
   */
  async getAppOwnerId(): Promise<{ openId: string; source: 'creator' | 'owner' } | null> {
    const data = await this.call(
      'GET',
      `/application/v6/applications/${this.appId}?lang=zh_cn&user_id_type=open_id`,
      {},
    );
    const app = data.data?.app;
    if (!app) return null;

    // `owner.owner_id` is the current owner, which the console lets an admin
    // transfer; `creator_id` is whoever first created the app. Prefer the
    // owner and fall back to the creator, but only accept `ou_`-prefixed
    // values: the owner slot can also hold a tenant-level or partner entry,
    // which is not a person and would never match an inbound sender id.
    const candidates: Array<{ source: 'creator' | 'owner'; value: unknown }> = [
      { source: 'owner', value: app.owner?.owner_id },
      { source: 'creator', value: app.creator_id },
    ];
    for (const { source, value } of candidates) {
      if (typeof value === 'string' && value.startsWith('ou_')) return { openId: value, source };
    }
    return null;
  }

  async getUserInfo(openId: string): Promise<{ name?: string } | null> {
    const userIdType = openId.startsWith('ou_')
      ? 'open_id'
      : openId.startsWith('on_')
        ? 'union_id'
        : 'user_id';

    const data = await this.call(
      'GET',
      `/contact/v3/users/${openId}?user_id_type=${userIdType}`,
      {},
    );
    const user = data.data?.user;
    if (!user) return null;

    const name = user.name || user.display_name || user.nickname || user.en_name;
    return name ? { name } : null;
  }

  // ------------------------------------------------------------------
  // Outbound media + non-text messages
  // ------------------------------------------------------------------

  /**
   * Upload an image to Lark/Feishu's message-scoped image store. Returns the
   * `image_key` you'd pass through `sendMessageWithMsgType(chatId, 'image',
   * JSON.stringify({ image_key }))` to actually deliver it.
   *
   * See: https://open.feishu.cn/document/server-docs/im-v1/image/create
   */
  async uploadImage(buffer: Buffer, name?: string): Promise<{ image_key: string }> {
    const form = new FormData();
    form.append('image_type', 'message');
    form.append(
      'image',
      new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }),
      name ?? 'image',
    );
    const data = await this.callMultipart('/im/v1/images', form);
    return { image_key: data.data.image_key };
  }

  /**
   * Upload a file (or audio / video / generic stream) to Lark/Feishu's
   * message-scoped file store. `fileType` controls how the receiver
   * previews the file. Returns the `file_key` you'd pass through
   * `sendMessageWithMsgType(chatId, 'file', JSON.stringify({ file_key }))`
   * (or `'audio' | 'media'` depending on the source).
   *
   * See: https://open.feishu.cn/document/server-docs/im-v1/file/create
   */
  async uploadFile(
    buffer: Buffer,
    name: string,
    fileType: 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream',
  ): Promise<{ file_key: string }> {
    const form = new FormData();
    form.append('file_type', fileType);
    form.append('file_name', name);
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }),
      name,
    );
    const data = await this.callMultipart('/im/v1/files', form);
    return { file_key: data.data.file_key };
  }

  /**
   * Send a non-text Lark/Feishu message. `content` must already be the
   * platform-specific JSON-stringified payload (e.g. `{"image_key":"..."}`
   * for `msg_type='image'`).
   *
   * See: https://open.feishu.cn/document/server-docs/im-v1/message/create
   */
  async sendMessageWithMsgType(
    chatId: string,
    msgType: 'image' | 'file' | 'audio' | 'media',
    content: string,
  ): Promise<{ messageId: string; raw: any }> {
    const data = await this.call('POST', '/im/v1/messages?receive_id_type=chat_id', {
      content,
      msg_type: msgType,
      receive_id: chatId,
    });
    return { messageId: data.data.message_id, raw: data.data };
  }

  // ------------------------------------------------------------------
  // Media / Resource download
  // ------------------------------------------------------------------

  /**
   * Download a message resource (image, file, audio, video, sticker).
   *
   * @see https://open.feishu.cn/document/server-docs/im-v1/message-attachment/get
   * @param messageId - The message_id that contains the resource
   * @param fileKey   - file_key or image_key from the message content
   * @param type      - Resource type: 'image' | 'file'
   */
  async downloadResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file',
  ): Promise<Buffer> {
    const token = await this.getTenantAccessToken();
    const url = `${this.baseUrl}/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lark downloadResource failed: ${response.status} ${text}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // ------------------------------------------------------------------
  // Cloud documents (docx / wiki)
  // ------------------------------------------------------------------

  /**
   * Metadata of a docx document: title + revision. Needs
   * `docx:document:readonly` (or `docx:document`) on the app, AND the
   * document must be visible to the app — via a group the bot is in, or by
   * adding the app as a collaborator.
   *
   * @see https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/get
   */
  async getDocxDocument(
    documentId: string,
  ): Promise<{ documentId: string; revisionId?: number; title?: string }> {
    const data = await this.call('GET', `/docx/v1/documents/${documentId}`, {});
    const doc = data.data?.document ?? {};
    return {
      documentId: doc.document_id ?? documentId,
      revisionId: doc.revision_id,
      title: doc.title,
    };
  }

  /**
   * Plain-text body of a docx document (headings, paragraphs, table cells
   * flattened into text — no block structure). Same scope as
   * {@link getDocxDocument}. Rate-limited to 5 req/s per app.
   *
   * @see https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content
   */
  async getDocxRawContent(documentId: string): Promise<string> {
    const data = await this.call('GET', `/docx/v1/documents/${documentId}/raw_content`, {});
    return typeof data.data?.content === 'string' ? data.data.content : '';
  }

  /**
   * Resolve a wiki node token to the underlying object it wraps. A wiki
   * link (`/wiki/<token>`) is a tree node, not a document; the document
   * token to feed the docx endpoints is `obj_token` (when `obj_type` is
   * `docx`). Needs `wiki:wiki:readonly` (or `wiki:wiki`) on the app.
   *
   * @see https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node
   */
  async getWikiNode(
    token: string,
  ): Promise<{ nodeToken: string; objToken?: string; objType?: string; title?: string }> {
    const params = new URLSearchParams({ token });
    const data = await this.call('GET', `/wiki/v2/spaces/get_node?${params.toString()}`, {});
    const node = data.data?.node ?? {};
    return {
      nodeToken: node.node_token ?? token,
      objToken: node.obj_token,
      objType: node.obj_type,
      title: node.title,
    };
  }

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  async getTenantAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const response = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lark auth failed: ${response.status} ${text}`);
    }

    const data: any = await response.json();
    if (data.code !== 0) {
      throw new Error(`Lark auth error: ${data.code} ${data.msg}`);
    }

    this.cachedToken = data.tenant_access_token;
    // Expire 5 minutes early to avoid edge cases
    this.tokenExpiresAt = Date.now() + (data.expire - 300) * 1000;

    return this.cachedToken!;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private truncateText(text: string): string {
    if (text.length > MAX_TEXT_LENGTH) return text.slice(0, MAX_TEXT_LENGTH - 3) + '...';
    return text;
  }

  /**
   * Flatten the `error` object Lark attaches to a failed response.
   *
   * `code` + `msg` alone are close to useless for the two failures operators
   * actually hit: a permission error says `230027 Permission denied` and
   * nothing about WHICH scope is missing — even though Lark puts exactly that
   * in `error.permission_violations`. Dropping it sent a real debugging session
   * hunting for a scope name in our own docs instead of reading it off the
   * response. `troubleshooter` is Lark's own log-id-scoped diagnosis link.
   */
  private static describeError(error: any): string {
    if (!error || typeof error !== 'object') return '';
    const parts: string[] = [];

    const violations = Array.isArray(error.permission_violations)
      ? error.permission_violations
      : [];
    for (const violation of violations) {
      const subject = violation?.subject ?? violation?.type;
      const description = violation?.description;
      const detail = [subject, description].filter(Boolean).join(': ');
      if (detail) parts.push(`missing permission — ${detail}`);
    }

    if (typeof error.troubleshooter === 'string' && error.troubleshooter) {
      parts.push(error.troubleshooter);
    }

    return parts.length > 0 ? ` (${parts.join('; ')})` : '';
  }

  private async call(method: string, path: string, body: Record<string, unknown>): Promise<any> {
    const token = await this.getTenantAccessToken();
    const url = `${this.baseUrl}${path}`;

    const init: RequestInit = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method,
    };

    if (method !== 'GET' && method !== 'DELETE') {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lark API ${method} ${path} failed: ${response.status} ${text}`);
    }

    const data: any = await response.json();

    if (data.code !== 0) {
      throw new Error(
        `Lark API ${method} ${path} failed: ${data.code} ${data.msg}${LarkApiClient.describeError(data.error)}`,
      );
    }

    return data;
  }

  /**
   * `multipart/form-data` POST variant for endpoints that accept file
   * uploads (`/im/v1/images`, `/im/v1/files`). Auth header is still required;
   * the multipart boundary header is set automatically by undici when `body`
   * is a `FormData` instance.
   */
  private async callMultipart(path: string, form: FormData): Promise<any> {
    const token = await this.getTenantAccessToken();
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      body: form,
      headers: { Authorization: `Bearer ${token}` },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lark API multipart POST ${path} failed: ${response.status} ${text}`);
    }

    const data: any = await response.json();
    if (data.code !== 0) {
      throw new Error(`Lark API multipart POST ${path} failed: ${data.code} ${data.msg}`);
    }
    return data;
  }
}
