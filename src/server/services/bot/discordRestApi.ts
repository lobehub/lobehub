import { REST } from '@discordjs/rest';
import debug from 'debug';
import { type RESTPostAPIChannelMessageResult, Routes } from 'discord-api-types/v10';

const log = debug('lobe-server:bot:discord-rest');

export class DiscordRestApi {
  private readonly rest: REST;

  constructor(botToken: string) {
    this.rest = new REST({ version: '10' }).setToken(botToken);
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    log('editMessage: channel=%s, message=%s', channelId, messageId);
    await this.rest.patch(Routes.channelMessage(channelId, messageId), { body: { content } });
  }

  async triggerTyping(channelId: string): Promise<void> {
    log('triggerTyping: channel=%s', channelId);
    await this.rest.post(Routes.channelTyping(channelId));
  }

  async removeOwnReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    log('removeOwnReaction: channel=%s, message=%s, emoji=%s', channelId, messageId, emoji);
    await this.rest.delete(
      Routes.channelMessageOwnReaction(channelId, messageId, encodeURIComponent(emoji)),
    );
  }

  async updateChannelName(channelId: string, name: string): Promise<void> {
    const truncatedName = name.slice(0, 100); // Discord thread name limit
    log('updateChannelName: channel=%s, name=%s', channelId, truncatedName);
    await this.rest.patch(Routes.channel(channelId), { body: { name: truncatedName } });
  }

  async createMessage(channelId: string, content: string): Promise<{ id: string }> {
    log('createMessage: channel=%s', channelId);
    const data = (await this.rest.post(Routes.channelMessages(channelId), {
      body: { content },
    })) as RESTPostAPIChannelMessageResult;

    return { id: data.id };
  }
}
