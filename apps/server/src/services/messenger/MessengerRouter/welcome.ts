import type { Chat } from 'chat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';

import type { InstallationCredentials } from '../installations/types';
import type { MessengerPlatformBinder } from '../types';
import type { MessengerRouterDeps, RegisteredMessengerBot } from './types';

const log = debug('lobe-server:messenger:router');

/**
 * Slack-only welcome on first Messages-tab open. Slack's marketplace
 * listing rule: apps that enable the Messages tab MUST send a welcome
 * the first time any user opens it. The `setIfNotExists` gate makes
 * sure follow-up opens (the same user clicking the tab again, multiple
 * webhook deliveries from Slack's retry policy) stay silent.
 *
 * chat-sdk state is already per-install (Redis keyPrefix in
 * `createChatBot`), so the gate key is implicitly workspace-scoped.
 * Unlinked users get the same Link Account CTA they'd see on a first
 * DM; linked users get a short ready-to-chat note with the active
 * agent name.
 */
export async function handleAppHomeOpened(
  deps: MessengerRouterDeps,
  bot: RegisteredMessengerBot,
  creds: InstallationCredentials,
  event: { channelId: string; userId: string },
): Promise<void> {
  const stateAdapter = bot.chatBot.getState();
  const gateKey = `app_home_welcomed:${event.userId}`;
  try {
    const fresh = await stateAdapter.setIfNotExists(gateKey, '1');
    if (!fresh) return;
  } catch (error) {
    log('handleAppHomeOpened: dedupe gate failed: %O', error);
    return;
  }

  try {
    const serverDB = await getServerDB();
    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      creds.platform,
      event.userId,
      creds.tenantId,
    );

    if (!link) {
      await bot.binder.handleUnlinkedMessage({
        authorUserId: event.userId,
        chatId: event.channelId,
      });
      return;
    }

    let activeAgentName: string | undefined;
    if (link.activeAgentId) {
      const userAgents = await deps.fetchUserAgents(serverDB, link.userId, link.workspaceId);
      activeAgentName = userAgents.find((a) => a.id === link.activeAgentId)?.title;
    }

    const text = activeAgentName
      ? `Welcome to LobeHub! Your active agent is *${activeAgentName}*. Send a message to chat, or use \`/agents\` to switch.`
      : 'Welcome to LobeHub! Send `/agents` to pick an active agent and start chatting.';
    await bot.binder.sendDmText(event.channelId, text);
  } catch (error) {
    log('handleAppHomeOpened: dispatch failed: %O', error);
  }
}

/**
 * Slack `member_joined_channel` welcome. Fires the first time the bot
 * itself joins a channel (via `/invite @LobeHub` or being added through the
 * channel settings). Slack retries `member_joined_channel` aggressively on
 * 5xx, and re-adding-then-removing-then-re-adding a bot would fire it again,
 * so `setIfNotExists` keys on the channel id to keep the greeting one-shot.
 *
 * The message lives in the channel (not as an ephemeral) because every
 * member should see what the bot is and how to start. Account linking is
 * intentionally pushed to a DM in the copy — verify-im URLs are personal
 * and must never be broadcast to the channel.
 */
export async function handleChannelJoin(
  chatBot: Chat<any>,
  binder: MessengerPlatformBinder,
  channelId: string,
): Promise<void> {
  const stateAdapter = chatBot.getState();
  const gateKey = `channel_welcomed:${channelId}`;
  try {
    const fresh = await stateAdapter.setIfNotExists(gateKey, '1');
    if (!fresh) return;
  } catch (error) {
    log('handleChannelJoin: dedupe gate failed: %O', error);
    return;
  }

  const text = [
    ":wave: Hi, I'm *LobeHub* — your AI agent on Slack.",
    '',
    '• Mention me with `@LobeHub <your question>` to chat in this channel.',
    '• First time? Send me a *direct message* to link your LobeHub account.',
    '• Use `/agents` in DM to switch the active agent.',
  ].join('\n');

  try {
    await binder.sendDmText(channelId, text);
  } catch (error) {
    log('handleChannelJoin: send failed: %O', error);
  }
}
