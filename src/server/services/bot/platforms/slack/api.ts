import { defaultEmojiResolver } from 'chat';
import debug from 'debug';

const log = debug('bot-platform:slack:client');

export const SLACK_API_BASE = 'https://slack.com/api';

/**
 * Normalize an emoji input to the shortcode that Slack's reactions API
 * expects (e.g. `eyes`, not the unicode `👀` and not `:eyes:`).
 *
 * Callers may pass any of:
 * - A unicode emoji like `👀` (e.g. BotCallbackService.removeEyesReaction)
 * - A normalized name like `thumbs_up` (which maps to Slack's `+1`)
 * - A Slack shortcode like `eyes` (already correct, idempotent pass-through)
 *
 * `defaultEmojiResolver.fromGChat` returns the EmojiValue for the unicode
 * (or a raw EmojiValue with the input as name if no mapping), and `toSlack`
 * then converts to the Slack format (or returns the input unchanged for
 * unknown names — keeping custom Slack emoji like `:meow_party:` working).
 */
function normalizeSlackEmoji(input: string): string {
  const stripped = input.replaceAll(':', '');
  return defaultEmojiResolver.toSlack(defaultEmojiResolver.fromGChat(stripped));
}

/**
 * Lightweight Slack Web API client for outbound messaging operations
 * used by callback and extension flows outside the Chat SDK adapter surface.
 */
export class SlackApi {
  private readonly botToken: string;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async postMessage(channel: string, text: string): Promise<{ ts: string }> {
    log('postMessage: channel=%s', channel);
    const data = await this.call('chat.postMessage', { channel, text: this.truncateText(text) });
    return { ts: data.ts };
  }

  async postMessageInThread(
    channel: string,
    threadTs: string,
    text: string,
  ): Promise<{ ts: string }> {
    log('postMessageInThread: channel=%s, thread=%s', channel, threadTs);
    const data = await this.call('chat.postMessage', {
      channel,
      text: this.truncateText(text),
      thread_ts: threadTs,
    });
    return { ts: data.ts };
  }

  async updateMessage(channel: string, ts: string, text: string): Promise<void> {
    log('updateMessage: channel=%s, ts=%s', channel, ts);
    await this.call('chat.update', { channel, text: this.truncateText(text), ts });
  }

  async removeReaction(channel: string, timestamp: string, name: string): Promise<void> {
    const slackName = normalizeSlackEmoji(name);
    log('removeReaction: channel=%s, ts=%s, name=%s', channel, timestamp, slackName);
    try {
      await this.call('reactions.remove', { channel, name: slackName, timestamp });
    } catch (error) {
      // `no_reaction` is benign: the reaction may have been removed already
      // (concurrent callback, user removed it manually) or never added in
      // the first place (e.g. an earlier reactions.add failed). Swallow it
      // so the callback path doesn't surface a misleading error.
      if (error instanceof Error && error.message.includes('no_reaction')) {
        log('removeReaction: no_reaction (already gone) ts=%s, name=%s', timestamp, slackName);
        return;
      }
      throw error;
    }
  }

  // ==================== Message Operations ====================

  async getHistory(
    channel: string,
    options?: {
      cursor?: string;
      inclusive?: boolean;
      latest?: string;
      limit?: number;
      oldest?: string;
    },
  ): Promise<{ has_more: boolean; messages: any[] }> {
    log('getHistory: channel=%s', channel);
    const data = await this.call('conversations.history', { channel, ...options });
    return { has_more: data.has_more ?? false, messages: data.messages ?? [] };
  }

  async deleteMessage(channel: string, ts: string): Promise<void> {
    log('deleteMessage: channel=%s, ts=%s', channel, ts);
    await this.call('chat.delete', { channel, ts });
  }

  async search(
    query: string,
    options?: { count?: number; sort?: string },
  ): Promise<{ matches: any[]; total: number }> {
    log('search: query=%s', query);
    const data = await this.call('search.messages', { query, ...options });
    return {
      matches: data.messages?.matches ?? [],
      total: data.messages?.total ?? 0,
    };
  }

  // ==================== Reactions ====================

  async addReaction(channel: string, timestamp: string, name: string): Promise<void> {
    const slackName = normalizeSlackEmoji(name);
    log('addReaction: channel=%s, ts=%s, name=%s', channel, timestamp, slackName);
    await this.call('reactions.add', { channel, name: slackName, timestamp });
  }

  async getReactions(
    channel: string,
    timestamp: string,
  ): Promise<{ reactions: { count: number; name: string; users: string[] }[] }> {
    log('getReactions: channel=%s, ts=%s', channel, timestamp);
    const data = await this.call('reactions.get', { channel, timestamp });
    return { reactions: data.message?.reactions ?? [] };
  }

  // ==================== Pins ====================

  async pinMessage(channel: string, timestamp: string): Promise<void> {
    log('pinMessage: channel=%s, ts=%s', channel, timestamp);
    await this.call('pins.add', { channel, timestamp });
  }

  async unpinMessage(channel: string, timestamp: string): Promise<void> {
    log('unpinMessage: channel=%s, ts=%s', channel, timestamp);
    await this.call('pins.remove', { channel, timestamp });
  }

  async listPins(channel: string): Promise<{ items: any[] }> {
    log('listPins: channel=%s', channel);
    const data = await this.call('pins.list', { channel });
    return { items: data.items ?? [] };
  }

  // ==================== Channel & User Info ====================

  async getChannelInfo(channel: string): Promise<any> {
    log('getChannelInfo: channel=%s', channel);
    const data = await this.call('conversations.info', { channel, include_num_members: true });
    return data.channel;
  }

  async listChannels(options?: {
    exclude_archived?: boolean;
    limit?: number;
    types?: string;
  }): Promise<{ channels: any[]; response_metadata?: { next_cursor?: string } }> {
    log('listChannels');
    const data = await this.call('conversations.list', {
      exclude_archived: true,
      limit: 200,
      types: 'public_channel,private_channel',
      ...options,
    });
    return {
      channels: data.channels ?? [],
      response_metadata: data.response_metadata,
    };
  }

  async getUserInfo(userId: string): Promise<any> {
    log('getUserInfo: userId=%s', userId);
    const data = await this.call('users.info', { user: userId });
    return data.user;
  }

  async getReplies(channel: string, threadTs: string): Promise<{ messages: any[] }> {
    log('getReplies: channel=%s, threadTs=%s', channel, threadTs);
    const data = await this.call('conversations.replies', { channel, ts: threadTs });
    return { messages: data.messages ?? [] };
  }

  // ==================== File Download ====================

  /**
   * Download a Slack file by its `url_private` URL using the bot token.
   *
   * Slack's file URLs (`https://files.slack.com/files-pri/...`) require Bearer
   * auth — fetching them without the bot token returns an HTML login page
   * (which we explicitly detect and report). The chat-adapter-slack normally
   * encloses the bot token in a `fetchData` closure on each Attachment, but
   * the closure is stripped by `Message.toJSON` when messages round-trip
   * through the chat-sdk debounce/queue. This method is the post-Redis
   * recovery path used by `SlackWebhookClient.extractFiles` and
   * `SlackSocketModeClient.extractFiles`.
   */
  async downloadFile(url: string): Promise<Buffer> {
    log('downloadFile: url=%s', url);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.botToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download Slack file: ${response.status} ${response.statusText}`);
    }

    // Slack returns an HTML login page (not a 4xx) when auth fails or the
    // bot lacks `files:read`. Detect that explicitly so the error is
    // actionable instead of getting a corrupted "buffer" of HTML bytes.
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new Error(
        `Failed to download file from Slack: received HTML login page instead of file data. ` +
          `Ensure your Slack app has the "files:read" OAuth scope. URL: ${url}`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // ------------------------------------------------------------------

  private truncateText(text: string): string {
    // Slack message limit is ~40000, but we respect the user-configured charLimit
    if (text.length > 40_000) return text.slice(0, 39_997) + '...';
    return text;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<any> {
    const url = `${SLACK_API_BASE}/${method}`;

    // Use application/x-www-form-urlencoded for maximum compatibility.
    // Some Slack methods (conversations.info, reactions.get, etc.) do not
    // accept JSON body parameters via POST, but all methods accept form-encoded.
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) {
        params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    }

    const response = await fetch(url, {
      body: params,
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      log('Slack API error: method=%s, status=%d, body=%s', method, response.status, text);
      throw new Error(`Slack API ${method} failed: ${response.status} ${text}`);
    }

    const data = await response.json();

    if (!data.ok) {
      log('Slack API logical error: method=%s, error=%s', method, data.error);
      throw new Error(`Slack API ${method} failed: ${data.error}`);
    }

    return data;
  }
}
