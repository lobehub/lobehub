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

  async createMessage(channelId: string, content: string): Promise<{ id: string }> {
    log('createMessage: channel=%s', channelId);
    const data = (await this.rest.post(Routes.channelMessages(channelId), {
      body: { content },
    })) as RESTPostAPIChannelMessageResult;

    return { id: data.id };
  }
}
