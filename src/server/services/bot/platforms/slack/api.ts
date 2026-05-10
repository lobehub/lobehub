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

  /**
   * Post a message with a single URL button rendered as an actions block.
   * `text` is also sent as fallback for clients that can't render blocks
   * (notifications, screen readers, etc.).
   */
  async postMessageWithUrlButton(
    channel: string,
    text: string,
    button: { text: string; url: string },
  ): Promise<{ ts: string }> {
    log('postMessageWithUrlButton: channel=%s', channel);
    const fallback = this.truncateText(text);
    const data = await this.call('chat.postMessage', {
      blocks: [
        { text: { text: fallback, type: 'mrkdwn' }, type: 'section' },
        {
          elements: [
            {
              text: { emoji: true, text: button.text, type: 'plain_text' },
              type: 'button',
              url: button.url,
            },
          ],
          type: 'actions',
        },
      ],
      channel,
      text: fallback,
    });
    return { ts: data.ts };
  }

  /**
   * Post a message that combines a Block Kit URL button AND the same URL
   * rendered as a plain inline link below it (邮件式 fallback). Mirrors how
   * email templates render "Click [Verify] / Or copy this link: …" so users
   * have a path through every Slack client (mobile, screen reader, copy-to-
   * other-device, future Block Kit regressions).
   *
   * Posted via `chat.postMessage` (NOT `chat.postEphemeral`) so the message
   * stays in DM history and the user can come back to it.
   */
  async postMessageWithButtonAndLink(
    channel: string,
    intro: string,
    button: { text: string; url: string },
    linkLabel: string,
  ): Promise<{ ts: string }> {
    log('postMessageWithButtonAndLink: channel=%s', channel);
    const fallback = this.truncateText(intro);
    const data = await this.call('chat.postMessage', {
      blocks: [
        { text: { text: fallback, type: 'mrkdwn' }, type: 'section' },
        {
          elements: [
            {
              text: { emoji: true, text: button.text, type: 'plain_text' },
              type: 'button',
              url: button.url,
            },
          ],
          type: 'actions',
        },
        // mrkdwn auto-linkifies the URL when rendered; older clients that
        // can't render the actions block above still see this section.
        { text: { text: this.truncateText(linkLabel), type: 'mrkdwn' }, type: 'section' },
      ],
      channel,
      text: fallback,
    });
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

  /**
   * Post a message with a grid of action buttons (Block Kit `actions` block).
   * Each button carries an `action_id` (≤ 255 chars) which the bot receives
   * back via the interactive webhook (`block_actions` payload) when tapped.
   * `text` is also sent as fallback for clients that can't render blocks.
   *
   * Slack caps a single `actions` block at 25 elements; if the keyboard is
   * larger we split across multiple actions blocks.
   */
  async postMessageWithButtonGrid(
    channel: string,
    text: string,
    buttons: Array<{
      actionId: string;
      style?: 'primary' | 'danger';
      text: string;
      value?: string;
    }>,
  ): Promise<{ ts: string }> {
    log('postMessageWithButtonGrid: channel=%s, buttons=%d', channel, buttons.length);
    const fallback = this.truncateText(text);
    const data = await this.call('chat.postMessage', {
      blocks: this.buildButtonGridBlocks(fallback, buttons),
      channel,
      text: fallback,
    });
    return { ts: data.ts };
  }

  /**
   * Ephemeral variant of `postMessageWithButtonGrid` — only the targeted
   * `user` sees the picker. Used by the messenger `/agents` flow when
   * invoked from a public channel so we don't broadcast the user's
   * personal agent list to the whole channel. Pair with
   * `respondToActionUrl({ replaceOriginal: true })` in the action callback
   * — `chat.update` cannot edit ephemerals.
   */
  async postEphemeralWithButtonGrid(
    channel: string,
    user: string,
    text: string,
    buttons: Array<{
      actionId: string;
      style?: 'primary' | 'danger';
      text: string;
      value?: string;
    }>,
    options?: { threadTs?: string },
  ): Promise<void> {
    log(
      'postEphemeralWithButtonGrid: channel=%s, user=%s, buttons=%d',
      channel,
      user,
      buttons.length,
    );
    const fallback = this.truncateText(text);
    const payload: Record<string, unknown> = {
      blocks: this.buildButtonGridBlocks(fallback, buttons),
      channel,
      text: fallback,
      user,
    };
    if (options?.threadTs) payload.thread_ts = options.threadTs;
    await this.call('chat.postEphemeral', payload);
  }

  /**
   * Replace an ephemeral picker in place via the action callback's
   * `response_url`. `chat.update` cannot edit ephemerals, so this is the
   * only path. The `response_url` is valid for ~30 minutes / 5 calls per
   * interaction.
   */
  async updateEphemeralButtonGrid(
    responseUrl: string,
    text: string,
    buttons: Array<{
      actionId: string;
      style?: 'primary' | 'danger';
      text: string;
      value?: string;
    }>,
  ): Promise<void> {
    log('updateEphemeralButtonGrid: buttons=%d', buttons.length);
    const fallback = this.truncateText(text);
    const response = await fetch(responseUrl, {
      body: JSON.stringify({
        blocks: this.buildButtonGridBlocks(fallback, buttons),
        replace_original: true,
        text: fallback,
      }),
      headers: { 'content-type': 'application/json; charset=utf-8' },
      method: 'POST',
    });
    if (!response.ok) {
      const errText = await response.text();
      log('updateEphemeralButtonGrid: status=%d body=%s', response.status, errText);
      throw new Error(`Slack response_url POST failed: ${response.status} ${errText}`);
    }
  }

  /**
   * Replace an existing message's text + button grid in place. Used to
   * re-render the picker after one of its options is selected so the new
   * active marker is visible.
   */
  async updateMessageWithButtonGrid(
    channel: string,
    ts: string,
    text: string,
    buttons: Array<{
      actionId: string;
      style?: 'primary' | 'danger';
      text: string;
      value?: string;
    }>,
  ): Promise<void> {
    log('updateMessageWithButtonGrid: channel=%s, ts=%s', channel, ts);
    const fallback = this.truncateText(text);
    await this.call('chat.update', {
      blocks: this.buildButtonGridBlocks(fallback, buttons),
      channel,
      text: fallback,
      ts,
    });
  }

  async updateMessage(channel: string, ts: string, text: string): Promise<void> {
    log('updateMessage: channel=%s, ts=%s', channel, ts);
    await this.call('chat.update', { channel, text: this.truncateText(text), ts });
  }

  /**
   * Post an ephemeral message visible only to `user` in `channel`. Slack has
   * no native button-tap toast (unlike Telegram's `answerCallbackQuery`) so
   * this is what we use to surface short feedback after an interactive
   * action — e.g. "Switched to Foo." Requires the `chat:write` scope.
   *
   * `threadTs` anchors the ephemeral in a Slack thread (e.g. when responding
   * to an `@mention` so the prompt appears next to the mention, not at the
   * bottom of the channel). Slack ignores `thread_ts` for DMs.
   */
  async postEphemeral(
    channel: string,
    user: string,
    text: string,
    options?: { threadTs?: string },
  ): Promise<void> {
    log('postEphemeral: channel=%s, user=%s, threadTs=%s', channel, user, options?.threadTs);
    const payload: Record<string, unknown> = {
      channel,
      text: this.truncateText(text),
      user,
    };
    if (options?.threadTs) payload.thread_ts = options.threadTs;
    await this.call('chat.postEphemeral', payload);
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

  /**
   * Verify the bot token is still valid for this install. Used by the
   * messenger settings page to reconcile stale local install rows when Slack
   * app removal didn't reach our lifecycle webhook.
   */
  async authTest(): Promise<{
    appId?: string;
    botId?: string;
    team?: string;
    teamId?: string;
    userId?: string;
  }> {
    log('authTest');
    const data = await this.call('auth.test', {});
    return {
      appId: data.app_id,
      botId: data.bot_id,
      team: data.team,
      teamId: data.team_id,
      userId: data.user_id,
    };
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

  private buildButtonGridBlocks(
    text: string,
    buttons: Array<{
      actionId: string;
      style?: 'primary' | 'danger';
      text: string;
      value?: string;
    }>,
  ): unknown[] {
    const elements = buttons.map((b) => ({
      action_id: b.actionId,
      text: { emoji: true, text: b.text, type: 'plain_text' },
      type: 'button',
      ...(b.style ? { style: b.style } : {}),
      ...(b.value !== undefined ? { value: b.value } : {}),
    }));

    // Slack caps each `actions` block at 25 elements — chunk if larger.
    const chunks: unknown[][] = [];
    for (let i = 0; i < elements.length; i += 25) chunks.push(elements.slice(i, i + 25));

    return [
      { text: { text, type: 'mrkdwn' }, type: 'section' },
      ...chunks.map((els) => ({ elements: els, type: 'actions' })),
    ];
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
