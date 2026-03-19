import debug from 'debug';

const log = debug('bot-platform:slack:client');

export const SLACK_API_BASE = 'https://slack.com/api';

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
    log('removeReaction: channel=%s, ts=%s, name=%s', channel, timestamp, name);
    await this.call('reactions.remove', { channel, name, timestamp });
  }

  // ------------------------------------------------------------------

  private truncateText(text: string): string {
    // Slack message limit is ~40000, but we respect the user-configured charLimit
    if (text.length > 40_000) return text.slice(0, 39_997) + '...';
    return text;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<any> {
    const url = `${SLACK_API_BASE}/${method}`;

    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
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
