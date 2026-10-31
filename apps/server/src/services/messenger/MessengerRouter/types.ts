import type { Chat, Message } from 'chat';

import type { MessengerPlatform } from '@/config/messenger';
import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import type { PlatformClient } from '@/server/services/bot/platforms';

import type { InstallationCredentials } from '../installations/types';
import type { MessengerPlatformBinder } from '../types';

export interface RegisteredMessengerBot {
  /** Chat SDK adapters keyed by platform id, as passed to the `Chat` config. */
  adapters: Record<string, any>;
  binder: MessengerPlatformBinder;
  chatBot: Chat<any>;
  client: PlatformClient;
  /** Cached resolved credentials — null for global-bot platforms (Telegram). */
  creds: InstallationCredentials;
}

export interface CommandMatch {
  args: string;
  name: string;
}

export interface AgentSummary {
  id: string;
  /** The caller's own private agent inside a workspace scope (always false in
   *  the personal scope, where every agent is implicitly private). */
  isPrivate: boolean;
  title: string;
}

/**
 * Per-message context passed to every command handler. Mirrors
 * `BotMessageRouter`'s `CommandContext`: handlers stay platform-agnostic and
 * read whatever they need (`thread`, `link`, `binder`, …) off the context
 * rather than threading parameters through every entry point.
 *
 * `source` discriminates the dispatch path: `'text'` carries a chat-sdk
 * `thread` + `message` (commands like `/new` and `/stop` use these to drive
 * the runtime); `'slash'` is a native slash-command event without a thread.
 */
export interface MessengerCommandContext {
  args: string;
  authorUserId: string;
  authorUserName?: string;
  binder: MessengerPlatformBinder;
  /** Conversation id for outbound replies. For slash invocations from a
   *  public channel this is the slash-invocation channel; for text it's the
   *  DM thread. */
  chatId: string;
  /** Discord slash command interaction handle. Present only when dispatched
   *  by `handleSlashCommand` on Discord — handlers that emit interactive UI
   *  (e.g. `/agents` picker) must complete the deferred interaction via the
   *  follow-up webhook, otherwise Discord shows "Thinking..." indefinitely
   *  and eventually flips to "The application did not respond". */
  interaction?: { applicationId: string; token: string };
  /** Whether this invocation can receive a follow-up interactive picker. */
  interactiveReplies: boolean;
  /** True when the command was invoked from a 1:1 DM. Commands that surface
   *  user-private UI (e.g. `/agents` picker) widen private replies into
   *  ephemerals when this is false so the channel doesn't see them. */
  isDM: boolean;
  link: SafeMessengerAccountLink | undefined;
  message?: Message;
  platform: MessengerPlatform;
  /** Platform-aware reply: ephemeral on Slack slash, DM on Discord slash,
   *  `binder.sendDmText` on text dispatch. */
  reply: (text: string) => Promise<void>;
  serverDB: LobeChatDatabase;
  source: 'text' | 'slash';
  tenantId: string;
  thread?: any;
}

export interface MessengerCommand {
  description: string;
  handler: (ctx: MessengerCommandContext) => Promise<void>;
  name: string;
  /**
   * Native slash-command argument schema for platforms that require
   * arguments to be declared up-front (Discord, Slack). Without this,
   * Discord registers the command as zero-arg — clicking it from the
   * slash menu fires the handler with no value field shown to the user.
   * Mirrors `BotCommand.options` in `BotMessageRouter` so command authors
   * use the same shape across both routers.
   */
  options?: Array<{
    description: string;
    name: string;
    required?: boolean;
  }>;
}

/**
 * Router instance hooks the extracted stages call back through. Each hook
 * resolves on the router at call time, so the stages see the same instance
 * methods (and any test double installed on them) as the class itself.
 */
export interface MessengerRouterDeps {
  fetchUserAgents: (
    serverDB: LobeChatDatabase,
    userId: string,
    workspaceId?: string | null,
  ) => Promise<AgentSummary[]>;
  getCommandsForPlatform: (platform: MessengerPlatform) => MessengerCommand[];
}
