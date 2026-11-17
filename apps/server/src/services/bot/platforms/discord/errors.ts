import { DiscordAPIError } from '@discordjs/rest';
import { MessagePlatformError } from '@lobechat/builtin-tool-message/executionRuntime';

/** Discord JSON error codes the message tool explains (https://discord.com/developers/docs/topics/opcodes-and-status-codes#json). */
const DISCORD_UNKNOWN_CHANNEL = 10_003;
const DISCORD_UNKNOWN_GUILD = 10_004;
const DISCORD_MISSING_ACCESS = 50_001;
const DISCORD_MISSING_PERMISSIONS = 50_013;

/** The channel or server a failed request addressed, read from its route. */
const describeTarget = (url: string): string => {
  const channelId = url.match(/\/channels\/(\d+)/)?.[1];
  if (channelId) return `channel ${channelId}`;

  const guildId = url.match(/\/guilds\/(\d+)/)?.[1];
  if (guildId) return `server ${guildId}`;

  return 'the requested channel';
};

/**
 * Turn the Discord refusals that share one bare wording ("Missing Access") into errors that
 * name the reason and the next step. Discord answers 50001 both when the bot is not in the
 * channel's server and when its role lacks View Channel; a channel id alone cannot tell the two
 * apart, so the message names both. Other errors pass through unchanged.
 */
export const toDiscordToolError = (error: unknown): unknown => {
  if (!(error instanceof DiscordAPIError)) return error;

  const target = describeTarget(error.url);
  const base = { platformCode: error.code, status: error.status };

  switch (error.code) {
    case DISCORD_MISSING_ACCESS: {
      return new MessagePlatformError({
        ...base,
        code: 'DISCORD_MISSING_ACCESS',
        hint: "Do not retry, and do not probe other channels to work around it. Tell the user which channel is blocked and ask a server admin to add the bot to that server or give the bot's role View Channel on the channel (plus Read Message History to read and Send Messages to post). listChannels lists only the channels this bot can see.",
        kind: 'stop',
        message: `Missing Access (Discord ${error.code}): this bot cannot see ${target}. Either the bot is not a member of its server, or the bot's role lacks View Channel there.`,
      });
    }
    case DISCORD_MISSING_PERMISSIONS: {
      return new MessagePlatformError({
        ...base,
        code: 'DISCORD_MISSING_PERMISSIONS',
        hint: "Do not retry. Tell the user which channel and action were refused and ask a server admin to grant that permission to the bot's role.",
        kind: 'stop',
        message: `Missing Permissions (Discord ${error.code}): this bot can see ${target} but its role lacks the permission this action needs (for example Send Messages, Send Messages in Threads, Attach Files, Embed Links, Add Reactions, Create Public Threads or Manage Messages).`,
      });
    }
    case DISCORD_UNKNOWN_CHANNEL: {
      return new MessagePlatformError({
        ...base,
        code: 'DISCORD_UNKNOWN_CHANNEL',
        hint: 'Check the channel ID: call listChannels with the server ID and pick the channel from its result.',
        kind: 'replan',
        message: `Unknown Channel (Discord ${error.code}): ${target} does not exist or was deleted.`,
      });
    }
    case DISCORD_UNKNOWN_GUILD: {
      return new MessagePlatformError({
        ...base,
        code: 'DISCORD_UNKNOWN_GUILD',
        hint: 'Check the server ID (the serverId in the bot settings from listBots); if it is right, the bot must be invited to that server first.',
        kind: 'replan',
        message: `Unknown Guild (Discord ${error.code}): ${target} does not exist or this bot is not a member of it.`,
      });
    }
    default: {
      return error;
    }
  }
};

/**
 * The same Discord client, whose failed calls throw {@link toDiscordToolError} instead of the
 * bare Discord error. Scoped to the message tool: the bot runtime keeps its own unwrapped client.
 */
export const explainDiscordErrors = <T extends object>(api: T): T =>
  new Proxy(api, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;

      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          throw toDiscordToolError(error);
        }
      };
    },
  });
