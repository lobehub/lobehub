import type { ActionEvent } from 'chat';
import debug from 'debug';

import { getMessengerDiscordConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { DiscordClientFactory } from '@/server/services/bot/platforms/discord/client';

import { issueLinkToken } from '../../linkTokenStore';
import type {
  AgentPickerEntry,
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
  UnlinkedMessageContext,
} from '../../types';

const log = debug('lobe-server:messenger:discord');

/**
 * Application prefix on Discord button `custom_id`s so we can distinguish
 * OUR buttons from anything else the bot might emit later. Matches the
 * Slack/Telegram convention so the action handler can reuse the same
 * regex (`messenger:switch:<agentId>`).
 */
export const DISCORD_ACTION_PREFIX = 'messenger:';

export const buildDiscordSwitchButtons = (
  entries: AgentPickerEntry[],
): Array<{ customId: string; isPrimary: boolean; label: string }> =>
  entries.map((entry) => ({
    customId: `${DISCORD_ACTION_PREFIX}switch:${entry.id}`,
    isPrimary: entry.isActive,
    // Prepend a check so the active option is recognizable on clients that
    // ignore the primary-style highlight (most Discord clients do honor it,
    // but the marker is a useful redundancy).
    label: entry.isActive ? `✓ ${entry.title}` : entry.title,
  }));

const buildVerifyImUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'discord');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'messenger_discord');
  return url.toString();
};

/**
 * Open (or fetch the existing) DM channel between the bot and the user.
 *
 * Discord requires a channel id for `createMessage`; for outbound DMs we
 * therefore have to create the DM channel first via `POST /users/@me/channels`
 * (idempotent — re-calling for a user with an open DM returns the same id).
 *
 * Throws if the user has DMs disabled or doesn't share a guild with the
 * bot. Callers swallow + log so a single bad recipient doesn't crash the
 * link confirmation flow.
 */
const openDM = async (api: DiscordApi, recipientId: string): Promise<string | null> => {
  try {
    const dm = await api.createDMChannel(recipientId);
    return dm.id;
  } catch (error) {
    log('openDM: failed for recipient=%s: %O', recipientId, error);
    return null;
  }
};

/**
 * Discord messenger binder.
 *
 * Single global bot — there is no per-guild token exchange — so the binder
 * reads credentials from `system_bot_providers` on every call (mirrors
 * Telegram). The 30s in-memory cache in `getMessengerDiscordConfig` keeps
 * the DB out of the hot webhook path.
 *
 * MVP scope is DM-only: agent picker / interactive components ARE wired up
 * (see `sendAgentPicker` / `updateAgentPicker`), but the router defaults to
 * the text-based `/agents <n>` flow until LOBE-8489 lands native slash
 * registration.
 */
export class MessengerDiscordBinder implements MessengerPlatformBinder {
  async createClient(): Promise<PlatformClient | null> {
    const config = await getMessengerDiscordConfig();
    if (!config) return null;

    return new DiscordClientFactory().createClient(
      {
        applicationId: config.applicationId,
        credentials: {
          botToken: config.botToken,
          publicKey: config.publicKey,
        },
        platform: 'discord',
        settings: {},
      },
      { appUrl: appEnv.APP_URL },
    );
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const config = await getMessengerDiscordConfig();
    if (!config) return;

    const appUrl = appEnv.APP_URL;
    if (!appUrl) {
      log('handleUnlinkedMessage: APP_URL not set, cannot build verify-im link');
      return;
    }

    // Always resolve the user's DM channel via openDM(authorUserId): the
    // link prompt carries a one-shot token and must land privately, but
    // `chatId` may be a public slash-invocation channel when /start fires
    // outside a DM. createDMChannel is idempotent (returns the existing DM
    // if open), so the text path gets the same channel it would have
    // received via `chatId` at the cost of one extra round-trip.
    const api = new DiscordApi(config.botToken);
    const dmChannelId = await openDM(api, ctx.authorUserId);
    if (!dmChannelId) {
      log('handleUnlinkedMessage: failed to open DM for user=%s', ctx.authorUserId);
      return;
    }

    let randomId: string;
    try {
      randomId = await issueLinkToken({
        platform: 'discord',
        platformUserId: ctx.authorUserId,
        platformUsername: ctx.authorUserName,
      });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      try {
        await api.createMessage(
          dmChannelId,
          'LobeHub is temporarily unavailable. Please try again in a moment.',
        );
      } catch (err) {
        log('handleUnlinkedMessage: fallback createMessage failed: %O', err);
      }
      return;
    }

    const verifyUrl = buildVerifyImUrl({
      appUrl,
      platformUserId: ctx.authorUserId,
      randomId,
    });

    // Discord DMs render plain markdown — `[label](url)` becomes a clickable
    // link. Components (interactive buttons) require us to ack the original
    // interaction within 3s, which is incompatible with the messenger flow
    // where the unlinked message handler runs after the chat-sdk has already
    // dispatched the message — so we stick to a markdown link for v1.
    const text = [
      "Hi, I'm LobeHub — your AI agent in Discord.",
      'To start, link your LobeHub account.',
      '',
      `🔗 [Link Account](${verifyUrl})`,
      '',
      `Or copy this link: ${verifyUrl}`,
    ].join('\n');

    try {
      await api.createMessage(dmChannelId, text);
    } catch (error) {
      log('handleUnlinkedMessage: createMessage failed: %O', error);
    }
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
    /** Ignored — Discord is a global-token bot, no tenant scoping needed. */
    tenantId?: string;
  }): Promise<void> {
    const config = await getMessengerDiscordConfig();
    if (!config) return;

    const api = new DiscordApi(config.botToken);
    const dmChannelId = await openDM(api, params.platformUserId);
    if (!dmChannelId) return;

    const headline = '✅ Linked successfully! Your LobeHub account is now connected.';
    const tail = params.activeAgentName
      ? `\n\nActive agent: **${params.activeAgentName}**\n\nGo ahead and send your first message — send \`/agents\` any time to switch the active agent.`
      : '\n\nSend `/agents` to list your agents and pick the active one.';

    try {
      await api.createMessage(dmChannelId, `${headline}${tail}`);
    } catch (error) {
      log('notifyLinkSuccess: failed to send to %s: %O', params.platformUserId, error);
    }
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = await getMessengerDiscordConfig();
    if (!config) return;
    try {
      await new DiscordApi(config.botToken).createMessage(chatId, text);
    } catch (error) {
      log('sendDmText: failed to send to chat=%s: %O', chatId, error);
    }
  }

  /**
   * Post the agent picker as a Discord message with an ActionRow grid of
   * buttons (`messenger:switch:<agentId>` `custom_id`s). Click handling is
   * wired in `MessengerRouter.registerHandlers` via `bot.onAction(...)`,
   * which fires after `@chat-adapter/discord` ack's the interaction with
   * `type: 6 DEFERRED_UPDATE_MESSAGE` (so we have ~15 minutes to do the
   * actual update via REST without the user seeing a spinner).
   *
   * When invoked from a slash command (`params.interaction` set), the picker
   * MUST complete the deferred interaction by PATCHing `@original` — Discord
   * already ack'd with `type: 5 DeferredChannelMessageWithSource` via
   * `patchDiscordForwardedInteractions`, so posting a side-channel message
   * leaves the "Thinking..." indicator hanging until it times out into "The
   * application did not respond". Outside the slash context (e.g. from a
   * regular message handler) we still fall back to `createMessageWithButtons`.
   */
  async sendAgentPicker(
    chatId: string,
    params: {
      entries: AgentPickerEntry[];
      ephemeralTo?: string;
      interaction?: { applicationId: string; token: string };
      text: string;
    },
  ): Promise<void> {
    const config = await getMessengerDiscordConfig();
    if (!config) {
      log('sendAgentPicker: no config, skipping');
      return;
    }
    try {
      const api = new DiscordApi(config.botToken);
      const buttons = buildDiscordSwitchButtons(params.entries);
      if (params.interaction) {
        await api.editInteractionOriginalWithButtons(
          params.interaction.applicationId,
          params.interaction.token,
          params.text,
          buttons,
        );
        return;
      }
      await api.createMessageWithButtons(chatId, params.text, buttons);
    } catch (error) {
      log('sendAgentPicker: failed for chat=%s: %O', chatId, error);
    }
  }

  /**
   * Edit a previously-sent picker message in place — used by the
   * `bot.onAction` handler to move the active marker to the newly-tapped
   * agent. Idempotent: if the message no longer exists (user deleted it,
   * Discord pruned), Discord returns 404 and we swallow the error.
   */
  async updateAgentPicker(
    chatId: string,
    messageId: string,
    params: { entries: AgentPickerEntry[]; text: string },
  ): Promise<void> {
    const config = await getMessengerDiscordConfig();
    if (!config) return;
    try {
      const api = new DiscordApi(config.botToken);
      await api.editMessageWithButtons(
        chatId,
        messageId,
        params.text,
        buildDiscordSwitchButtons(params.entries),
      );
    } catch (error) {
      log('updateAgentPicker: failed for chat=%s msg=%s: %O', chatId, messageId, error);
    }
  }

  /**
   * Discord ack: chat-adapter-discord already replied to the interaction
   * with `DeferredUpdateMessage` (`type: 6`) by the time we run, so we have
   * the full ~15-minute follow-up window. There's no native toast on Discord —
   * we surface `toast` text as a regular DM message and re-render the picker
   * in place.
   */
  async acknowledgeCallback(
    action: InboundCallbackAction,
    ack: CallbackAcknowledgement,
  ): Promise<void> {
    if (ack.updatedPicker && action.messageId !== undefined) {
      await this.updateAgentPicker(action.chatId, String(action.messageId), ack.updatedPicker);
    }
    if (ack.toast) {
      await this.sendDmText(action.chatId, ack.toast);
    }
  }

  /**
   * Map a chat-sdk `onAction` event to an `InboundCallbackAction` for the
   * router's shared callback path. Returns null when the actionId isn't one
   * of our `messenger:*` button ids so unrelated chat-sdk actions pass
   * through quietly.
   */
  extractActionFromEvent(event: ActionEvent, client: PlatformClient): InboundCallbackAction | null {
    const actionId = event.actionId ?? '';
    if (!actionId.startsWith(DISCORD_ACTION_PREFIX)) return null;
    const fromUserId = event.user?.userId;
    if (!fromUserId) return null;
    return {
      // Discord doesn't separate ack id from the interaction; chat-adapter
      // handles the initial 3-second ack on its own. The follow-up flow uses
      // the channel id from `threadId`.
      callbackId: '',
      chatId: client.extractChatId(event.threadId),
      data: actionId,
      fromUserId,
      messageId: event.messageId,
    };
  }

  /**
   * Discord DMs are private by definition — replies just go to the same
   * channel the interaction was invoked from. (Public channel invocations
   * stay public until chat-adapter-discord surfaces the `flags: 64`
   * EPHEMERAL flag for interaction responses.)
   */
  async replyPrivately(channel: any, _user: any, text: string): Promise<void> {
    try {
      await channel.post(text);
    } catch (error) {
      log('replyPrivately: channel.post failed: %O', error);
    }
  }
}
