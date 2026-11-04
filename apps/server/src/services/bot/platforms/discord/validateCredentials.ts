import type { BotCredentialErrorCode, ValidationError, ValidationResult } from '../types';
import { DISCORD_BOT_TOKEN_PATTERN, DISCORD_PUBLIC_KEY_PATTERN } from './const';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Application flags that mean the Message Content privileged intent is on.
 * `_LIMITED` is what an unverified app (under 100 servers) gets when the
 * toggle in the Developer Portal's Bot page is enabled.
 * https://discord.com/developers/docs/resources/application#application-object-application-flags
 */
const GATEWAY_MESSAGE_CONTENT = 1 << 19;
const GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 18;

const codeForStatus = (status: number): BotCredentialErrorCode | undefined => {
  if (status === 401) return 'invalid_credentials';
  if (status === 403) return 'permission_denied';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_unavailable';
};

const getJson = async <T>(path: string, botToken: string): Promise<T | undefined> => {
  try {
    const res = await fetch(`${DISCORD_API_BASE}${path}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
};

/**
 * Check a Discord bot's credentials the way the bot will actually be used.
 *
 * A valid token alone is not a working bot: the most common reasons a
 * "connected" Discord bot never answers are that it was never added to a
 * server, that Message Content Intent is off, or that the Application ID
 * belongs to another app. Each is reported with its own code so the form can
 * say what to fix. The follow-up checks only report what Discord answered
 * definitely; a failed lookup is not treated as a failure of the bot.
 */
export const validateDiscordCredentials = async (
  credentials: Record<string, string>,
  applicationId?: string,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];

  if (!credentials.botToken) errors.push({ field: 'botToken', message: 'Bot Token is required' });
  if (!credentials.publicKey)
    errors.push({ field: 'publicKey', message: 'Public Key is required' });

  if (errors.length > 0) return { errors, valid: false };

  // Name the actual problem before spending a round-trip on it — a
  // malformed public key can't be caught by the API call at all, and a
  // malformed token would come back as a generic auth failure.
  if (!new RegExp(DISCORD_PUBLIC_KEY_PATTERN).test(credentials.publicKey))
    errors.push({
      field: 'publicKey',
      message: 'Public Key must be a 64-character hex string',
    });
  if (!new RegExp(DISCORD_BOT_TOKEN_PATTERN).test(credentials.botToken))
    errors.push({
      field: 'botToken',
      message: 'Bot Token must be three dot-separated segments, as shown in the Discord portal',
    });

  if (errors.length > 0) return { errors, valid: false };

  const { botToken } = credentials;

  try {
    const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) {
      return {
        errors: [
          {
            code: codeForStatus(res.status),
            field: 'botToken',
            message: `Failed to authenticate with Discord API (HTTP ${res.status})`,
          },
        ],
        valid: false,
      };
    }
  } catch {
    return {
      errors: [
        {
          code: 'upstream_unavailable',
          field: 'botToken',
          message: 'Failed to authenticate with Discord API',
        },
      ],
      valid: false,
    };
  }

  const [application, guilds] = await Promise.all([
    getJson<{ flags?: number; id?: string }>('/applications/@me', botToken),
    getJson<unknown[]>('/users/@me/guilds?limit=1', botToken),
  ]);

  if (application?.id && applicationId && application.id !== applicationId) {
    errors.push({
      code: 'application_mismatch',
      field: 'applicationId',
      message: `The bot token belongs to application ${application.id}, not ${applicationId}`,
    });
  }

  if (
    application &&
    typeof application.flags === 'number' &&
    (application.flags & (GATEWAY_MESSAGE_CONTENT | GATEWAY_MESSAGE_CONTENT_LIMITED)) === 0
  ) {
    errors.push({
      code: 'message_content_intent_disabled',
      field: 'botToken',
      message: 'Message Content Intent is not enabled for this application',
    });
  }

  if (Array.isArray(guilds) && guilds.length === 0) {
    errors.push({
      code: 'bot_not_installed',
      field: 'applicationId',
      message: 'The bot has not been added to any server yet',
    });
  }

  return errors.length > 0 ? { errors, valid: false } : { valid: true };
};
