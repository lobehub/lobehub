import type { SlashCommandEvent } from 'chat';

import type { MessengerPlatform } from '@/config/messenger';
import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import type { CommandMatch } from './types';

/**
 * Sentinel scope token for the Personal scope (whose real `workspaceId` is
 * `null`) so it can ride inside a button id (`messenger:scope:personal`),
 * which can't carry a null. Real workspaces use their own id. Workspace ids
 * are generated nanoids, so they never collide with this literal.
 */
export const PERSONAL_SCOPE_ID = 'personal';

/**
 * Pull the Discord interaction id + token off a chat-sdk slash event so
 * handlers can complete the deferred interaction via the follow-up webhook.
 *
 * chat-adapter-discord exposes the raw Discord interaction object on
 * `event.raw` (see `chat` SlashCommandEvent: "Platform-specific raw payload"),
 * which carries `application_id` and `token`. Returns undefined for other
 * platforms or when the shape doesn't match (defensive — the patch only
 * fires for Discord today).
 */
export const extractDiscordInteractionContext = (
  platform: MessengerPlatform,
  event: SlashCommandEvent,
): { applicationId: string; token: string } | undefined => {
  if (platform !== 'discord') return undefined;
  const raw = event.raw as { application_id?: unknown; token?: unknown } | null | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  if (typeof raw.application_id !== 'string' || typeof raw.token !== 'string') {
    return undefined;
  }
  return { applicationId: raw.application_id, token: raw.token };
};

/** Parse a leading `/cmd` (with optional args) out of a message. Returns null
 *  when the message isn't a command. Strips a trailing `@BotName` so commands
 *  invoked from group chats also match (Telegram appends the bot username). */
export const parseCommand = (text: string | undefined): CommandMatch | null => {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const match = trimmed.match(/^\/([a-z][\w-]*)(?:@\S+)?(?:\s(.*))?$/is);
  if (!match) return null;
  return { args: (match[2] ?? '').trim(), name: match[1].toLowerCase() };
};

/**
 * Re-pack a request body that was already drained by `req.text()` so we can
 * pass it on to chat-sdk / the binder. Original headers + URL preserved.
 */
export const reconstructRequest = (req: Request, rawBody: string): Request =>
  new Request(req.url, {
    body: rawBody,
    // `Request.duplex` is required when supplying a body to `new Request` in
    // some runtimes; cast to avoid TS narrowing differences across DOM lib
    // versions.
    headers: req.headers,
    method: req.method,
  } as RequestInit);

/**
 * Whether `userId` is still a member of `workspaceId`. The link's active scope
 * may point at a workspace the user has since been removed from; dispatch must
 * re-check before running that workspace's agent.
 */
export const userIsWorkspaceMember = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string,
): Promise<boolean> => {
  if (!(await isWorkspaceFeatureEnabledForUser(userId))) return false;

  const workspaces = await new WorkspaceModel(db, userId).listUserWorkspaces();
  return workspaces.some((w) => w.id === workspaceId);
};

export const isWorkspaceFeatureEnabledForUser = async (userId: string): Promise<boolean> => {
  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  return featureFlags.enableWorkspace === true;
};
