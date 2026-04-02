import { REST } from '@discordjs/rest';
import debug from 'debug';
import {
  ApplicationCommandType,
  ChannelType,
  type RESTGetAPIChannelMessageReactionUsersResult,
  type RESTGetAPIChannelMessageResult,
  type RESTGetAPIChannelMessagesResult,
  type RESTGetAPIChannelPinsResult,
  type RESTGetAPIChannelResult,
  type RESTGetAPIGuildChannelsResult,
  type RESTGetAPIGuildMemberResult,
  type RESTGetAPIGuildThreadsResult,
  type RESTPostAPIChannelMessageResult,
  type RESTPostAPIChannelThreadsResult,
  Routes,
} from 'discord-api-types/v10';

const log = debug('bot-platform:discord:client');

export class DiscordApi {
  private readonly rest: REST;

  constructor(botToken: string) {
    this.rest = new REST({ version: '10' }).setToken(botToken);
  }

  // ==================== DM ====================

  async createDMChannel(recipientId: string): Promise<{ id: string }> {
    log('createDMChannel: recipientId=%s', recipientId);
    const data = (await this.rest.post(Routes.userChannels(), {
      body: { recipient_id: recipientId },
    })) as { id: string };
    return { id: data.id };
  }

  // ==================== Existing Methods ====================

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

  // ==================== Message Operations ====================

  async getMessages(
    channelId: string,
    query?: { after?: string; before?: string; limit?: number },
  ): Promise<RESTGetAPIChannelMessagesResult> {
    log('getMessages: channel=%s, query=%o', channelId, query);
    return (await this.rest.get(Routes.channelMessages(channelId), {
      query: new URLSearchParams(
        Object.entries(query ?? {})
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    })) as RESTGetAPIChannelMessagesResult;
  }

  async getMessage(channelId: string, messageId: string): Promise<RESTGetAPIChannelMessageResult> {
    log('getMessage: channel=%s, message=%s', channelId, messageId);
    return (await this.rest.get(
      Routes.channelMessage(channelId, messageId),
    )) as RESTGetAPIChannelMessageResult;
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    log('deleteMessage: channel=%s, message=%s', channelId, messageId);
    await this.rest.delete(Routes.channelMessage(channelId, messageId));
  }

  async createReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    log('createReaction: channel=%s, message=%s, emoji=%s', channelId, messageId, emoji);
    await this.rest.put(
      Routes.channelMessageOwnReaction(channelId, messageId, encodeURIComponent(emoji)),
    );
  }

  async getReactions(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<RESTGetAPIChannelMessageReactionUsersResult> {
    log('getReactions: channel=%s, message=%s, emoji=%s', channelId, messageId, emoji);
    return (await this.rest.get(
      Routes.channelMessageReaction(channelId, messageId, encodeURIComponent(emoji)),
    )) as RESTGetAPIChannelMessageReactionUsersResult;
  }

  // ==================== Pin Operations ====================

  async pinMessage(channelId: string, messageId: string): Promise<void> {
    log('pinMessage: channel=%s, message=%s', channelId, messageId);
    await this.rest.put(Routes.channelPin(channelId, messageId));
  }

  async unpinMessage(channelId: string, messageId: string): Promise<void> {
    log('unpinMessage: channel=%s, message=%s', channelId, messageId);
    await this.rest.delete(Routes.channelPin(channelId, messageId));
  }

  async getPinnedMessages(channelId: string): Promise<RESTGetAPIChannelPinsResult> {
    log('getPinnedMessages: channel=%s', channelId);
    return (await this.rest.get(Routes.channelPins(channelId))) as RESTGetAPIChannelPinsResult;
  }

  // ==================== Channel & Guild Operations ====================

  async getChannel(channelId: string): Promise<RESTGetAPIChannelResult> {
    log('getChannel: channel=%s', channelId);
    return (await this.rest.get(Routes.channel(channelId))) as RESTGetAPIChannelResult;
  }

  async getGuildChannels(guildId: string): Promise<RESTGetAPIGuildChannelsResult> {
    log('getGuildChannels: guild=%s', guildId);
    return (await this.rest.get(Routes.guildChannels(guildId))) as RESTGetAPIGuildChannelsResult;
  }

  async getGuildMember(guildId: string, userId: string): Promise<RESTGetAPIGuildMemberResult> {
    log('getGuildMember: guild=%s, user=%s', guildId, userId);
    return (await this.rest.get(
      Routes.guildMember(guildId, userId),
    )) as RESTGetAPIGuildMemberResult;
  }

  // ==================== Thread Operations ====================

  async startThreadFromMessage(
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<RESTPostAPIChannelThreadsResult> {
    log('startThreadFromMessage: channel=%s, message=%s, name=%s', channelId, messageId, name);
    return (await this.rest.post(Routes.threads(channelId, messageId), {
      body: { name: name.slice(0, 100) },
    })) as RESTPostAPIChannelThreadsResult;
  }

  async startThreadWithoutMessage(
    channelId: string,
    name: string,
    content?: string,
  ): Promise<RESTPostAPIChannelThreadsResult> {
    log('startThreadWithoutMessage: channel=%s, name=%s', channelId, name);
    const body: Record<string, unknown> = {
      name: name.slice(0, 100),
      type: ChannelType.PublicThread,
    };
    if (content) {
      body.message = { content };
    }
    return (await this.rest.post(Routes.threads(channelId), {
      body,
    })) as RESTPostAPIChannelThreadsResult;
  }

  async listActiveThreads(guildId: string): Promise<RESTGetAPIGuildThreadsResult> {
    log('listActiveThreads: guild=%s', guildId);
    return (await this.rest.get(
      Routes.guildActiveThreads(guildId),
    )) as RESTGetAPIGuildThreadsResult;
  }

  // ==================== Search ====================

  async searchGuildMessages(
    guildId: string,
    query: Record<string, string>,
  ): Promise<{ messages: RESTGetAPIChannelMessagesResult[]; total_results: number }> {
    log('searchGuildMessages: guild=%s, query=%o', guildId, query);
    return (await this.rest.get(`/guilds/${guildId}/messages/search`, {
      query: new URLSearchParams(query),
    })) as { messages: RESTGetAPIChannelMessagesResult[]; total_results: number };
  }

  // ==================== Poll ====================

  async createPoll(
    channelId: string,
    question: string,
    answers: string[],
    durationHours?: number,
    multiselect?: boolean,
  ): Promise<RESTPostAPIChannelMessageResult> {
    log('createPoll: channel=%s, question=%s', channelId, question);
    return (await this.rest.post(Routes.channelMessages(channelId), {
      body: {
        poll: {
          allow_multiselect: multiselect ?? false,
          answers: answers.map((text) => ({ poll_media: { text } })),
          duration: durationHours ?? 24,
          question: { text: question },
        },
      },
    })) as RESTPostAPIChannelMessageResult;
  }

  async registerCommands(
    applicationId: string,
    commands: Array<{ command: string; description: string }>,
  ): Promise<void> {
    log('registerCommands: appId=%s, %d commands', applicationId, commands.length);
    await this.rest.put(Routes.applicationCommands(applicationId), {
      body: commands.map((c) => ({
        description: c.description,
        name: c.command,
        type: ApplicationCommandType.ChatInput,
      })),
    });
  }
}
