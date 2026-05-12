import { REST } from '@discordjs/rest';
import debug from 'debug';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ButtonStyle,
  ChannelType,
  ComponentType,
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

/**
 * Generic shape for a button rendered into a Discord ActionRow.
 *
 * Defined locally rather than re-exporting `discord-api-types` shapes so
 * callers stay one level above Discord's `ButtonStyle` enum (the messenger
 * picker only cares about "active" vs "default" — Discord-style mapping
 * happens inside `buildButtonComponents`).
 */
export interface DiscordButtonSpec {
  customId: string;
  /** When true, the button renders in Discord's primary (blue) style. */
  isPrimary?: boolean;
  label: string;
}

/** Discord caps each ActionRow at 5 buttons and each message at 5 ActionRows = 25 buttons. */
const DISCORD_MAX_BUTTONS_PER_ROW = 5;
const DISCORD_MAX_BUTTONS_PER_MESSAGE = 25;

const buildButtonComponents = (
  buttons: DiscordButtonSpec[],
): Array<{
  components: Array<{
    custom_id: string;
    label: string;
    style: ButtonStyle;
    type: ComponentType.Button;
  }>;
  type: ComponentType.ActionRow;
}> => {
  const truncated = buttons.slice(0, DISCORD_MAX_BUTTONS_PER_MESSAGE);
  const rows: Array<{
    components: Array<{
      custom_id: string;
      label: string;
      style: ButtonStyle;
      type: ComponentType.Button;
    }>;
    type: ComponentType.ActionRow;
  }> = [];
  for (let i = 0; i < truncated.length; i += DISCORD_MAX_BUTTONS_PER_ROW) {
    rows.push({
      components: truncated.slice(i, i + DISCORD_MAX_BUTTONS_PER_ROW).map((btn) => ({
        custom_id: btn.customId,
        // Discord caps button labels at 80 chars; longer agent names get truncated.
        label: btn.label.length > 80 ? `${btn.label.slice(0, 77)}...` : btn.label,
        style: btn.isPrimary ? ButtonStyle.Primary : ButtonStyle.Secondary,
        type: ComponentType.Button,
      })),
      type: ComponentType.ActionRow,
    });
  }
  return rows;
};

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

  /**
   * Post a message containing a grid of interactive buttons (Discord ActionRow
   * + Button components). Used by the messenger's agent picker so the user
   * can switch the active agent with a tap.
   *
   * Returns the message id so callers can later edit the picker in place via
   * {@link editMessageWithButtons} when the underlying state changes.
   */
  async createMessageWithButtons(
    channelId: string,
    content: string,
    buttons: DiscordButtonSpec[],
  ): Promise<{ id: string }> {
    log('createMessageWithButtons: channel=%s, buttons=%d', channelId, buttons.length);
    const data = (await this.rest.post(Routes.channelMessages(channelId), {
      body: {
        components: buildButtonComponents(buttons),
        content,
      },
    })) as RESTPostAPIChannelMessageResult;
    return { id: data.id };
  }

  /**
   * Complete a deferred slash command interaction by editing its `@original`
   * response with the actual content + button grid. Required after the
   * `patchDiscordForwardedInteractions` patch ack's a slash command with
   * `type: 5 DeferredChannelMessageWithSource` — without a follow-up to
   * `@original`, Discord eventually flips the "Thinking..." indicator to
   * "The application did not respond". Returns the resulting message id so
   * callers can later re-render the picker via {@link editMessageWithButtons}.
   *
   * Auth: the interaction token in the URL is the auth — no bot token, no
   * `Authorization` header. We use raw `fetch` rather than `@discordjs/rest`
   * so the REST client doesn't attach the bot token (Discord rejects bot-token
   * auth on interaction webhooks).
   */
  async editInteractionOriginalWithButtons(
    applicationId: string,
    interactionToken: string,
    content: string,
    buttons: DiscordButtonSpec[],
  ): Promise<{ id: string }> {
    log('editInteractionOriginalWithButtons: appId=%s, buttons=%d', applicationId, buttons.length);
    const response = await fetch(
      `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        body: JSON.stringify({
          components: buildButtonComponents(buttons),
          content,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      },
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord interaction follow-up failed: ${response.status} ${errorText}`);
    }
    const data = (await response.json()) as RESTPostAPIChannelMessageResult;
    return { id: data.id };
  }

  /**
   * Replace an existing message's content + button grid in place. Mirrors
   * Slack's `chat.update` flow used to re-render the picker after a button
   * is tapped so the new "active" marker shows up without spamming the chat.
   */
  async editMessageWithButtons(
    channelId: string,
    messageId: string,
    content: string,
    buttons: DiscordButtonSpec[],
  ): Promise<void> {
    log(
      'editMessageWithButtons: channel=%s, message=%s, buttons=%d',
      channelId,
      messageId,
      buttons.length,
    );
    await this.rest.patch(Routes.channelMessage(channelId, messageId), {
      body: {
        components: buildButtonComponents(buttons),
        content,
      },
    });
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
    commands: Array<{
      command: string;
      description: string;
      options?: Array<{ description: string; name: string; required?: boolean }>;
    }>,
  ): Promise<void> {
    log('registerCommands: appId=%s, %d commands', applicationId, commands.length);
    await this.rest.put(Routes.applicationCommands(applicationId), {
      body: commands.map((c) => ({
        description: c.description,
        name: c.command,
        // Map our generic option schema to Discord's option type. We only
        // surface string options today (Crockford-Base32 pairing codes);
        // extend the mapping when a new command needs ints/booleans/etc.
        ...(c.options && c.options.length > 0
          ? {
              options: c.options.map((opt) => ({
                description: opt.description,
                name: opt.name,
                required: opt.required ?? false,
                type: ApplicationCommandOptionType.String,
              })),
            }
          : {}),
        type: ApplicationCommandType.ChatInput,
      })),
    });
  }
}
