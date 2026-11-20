import type { Chat, Message, MessageContext } from 'chat';
import debug from 'debug';

import { getBotFeatureAccessState } from '@/business/server/bot/featureAccess';
import type { MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { AgentModel } from '@/database/models/agent';
import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import { AgentBridgeService } from '@/server/services/bot/AgentBridgeService';
import { buildBotContext } from '@/server/services/bot/buildBotContext';
import { isWholeGroupChatThreadId } from '@/server/services/bot/isWholeGroupChatThreadId';
import { getSameSenderMessages, mergeBotMessages } from '@/server/services/bot/mergeMessages';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { getBotReplyLocale } from '@/server/services/bot/platforms/const';
import { renderInlineError } from '@/server/services/bot/replyTemplate';

import type { InstallationCredentials } from '../installations/types';
import { getMessengerSystemStrings } from '../systemReply';
import type { MessengerPlatformBinder } from '../types';
import { handleCallbackAction } from './callbacks';
import { handleSlashCommand } from './commands';
import type { MessengerRouterDeps } from './types';
import { parseCommand, userIsWorkspaceMember } from './utils';
import { handleChannelJoin } from './welcome';

const log = debug('lobe-server:messenger:router');

export function registerHandlers(
  deps: MessengerRouterDeps,
  bot: Chat<any>,
  serverDB: LobeChatDatabase,
  client: PlatformClient,
  binder: MessengerPlatformBinder,
  creds: InstallationCredentials,
): void {
  const platform = creds.platform;
  const tenantId = creds.tenantId;
  const commands = deps.getCommandsForPlatform(platform);
  const systemStrings = getMessengerSystemStrings(platform);

  const handle = async (
    thread: any,
    message: Message,
    bridgeMethod: 'handleMention' | 'handleSubscribedMessage',
  ): Promise<void> => {
    if (message.author.isBot === true) return;

    const senderId = message.author.userId;
    if (!senderId) {
      log('handle: missing author.userId, dropping');
      return;
    }

    const chatId = client.extractChatId(thread.id);
    // Channel `@mention` (Slack today) — `thread.isDM` is false. The
    // unlinked path swaps to an ephemeral so the link prompt is visible
    // only to the mentioner; the no-active-agent prompt is also routed
    // ephemerally for the same reason. The chat-sdk thread.id carries
    // the platform's thread anchor (Slack: `slack:<channel>:<threadTs>`)
    // which the binder splits when posting in-thread.
    const isChannelMention = thread.isDM === false;
    const channelThreadTs = isChannelMention ? String(thread.id).split(':')[2] : undefined;
    const isOneShotMessage = binder.isOneShotMessage?.(message) === true;
    let oneShotReplySent = false;
    const replyToSender = (text: string): Promise<void> => {
      if (isOneShotMessage && binder.replyToMessage) {
        if (oneShotReplySent) return Promise.resolve();
        oneShotReplySent = true;
        return binder.replyToMessage(message, text);
      }
      if (isChannelMention && binder.replyEphemeral) {
        return binder.replyEphemeral({
          channelId: chatId,
          text,
          threadTs: channelThreadTs,
          userId: senderId,
        });
      }
      return binder.sendDmText(chatId, text);
    };

    // Everything below runs after the webhook was already acknowledged
    // (chat-sdk hands it to `waitUntil`), so the platform will not redeliver
    // it. Any failure — including the link lookup — must therefore end in a
    // reply the sender can act on (resend), never a silently dropped message.
    try {
      const link = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        platform,
        senderId,
        tenantId,
      );

      const parsed = parseCommand(message.text);
      if (parsed) {
        const command = commands.find((c) => c.name === parsed.name);
        if (command) {
          // Text-path command reply: in a DM `chat.postMessage` is fine
          // (the conversation is private already). In a channel `@mention`
          // we must NOT broadcast — `/new`, `/stop`, `/start` etc. all
          // surface user-private state. Route the reply through
          // `replyEphemeral` so only the invoker sees it. Anchor in the
          // mention's thread (Slack `thread_ts`) so the response sits next
          // to the trigger. Platforms without `replyEphemeral` (Telegram)
          // fall back to the regular DM path.
          await command.handler({
            args: parsed.args,
            authorUserId: senderId,
            authorUserName: message.author.userName,
            binder,
            chatId,
            interactiveReplies: !isOneShotMessage,
            isDM: !isChannelMention,
            link,
            message,
            platform,
            reply: replyToSender,
            serverDB,
            source: 'text',
            tenantId,
            thread,
          });
          return;
        }
        // Unknown slash text — pass through to the agent so legitimate
        // "/foo" prompts the user typed still reach them.
      }

      // Unbound sender → trigger link flow. For a channel mention pass
      // the raw thread.id so the binder can post the prompt as an
      // ephemeral anchored in the mention's thread instead of a public
      // DM-style message.
      if (!link) {
        await binder.handleUnlinkedMessage({
          authorUserId: senderId,
          authorUserName: message.author.userName,
          channelMentionThreadId: isChannelMention ? thread.id : undefined,
          chatId,
          message,
        });
        return;
      }

      // Bound but no active agent → prompt the user to pick one via /agents.
      // In a channel, route the prompt ephemerally so the entire channel
      // doesn't see the system message.
      if (!link.activeAgentId) {
        await replyToSender(systemStrings.noActiveAgent);
        return;
      }

      // Re-validate the active scope: it may point at a workspace the user
      // has since been removed from. Don't run another workspace's agent for
      // a non-member — prompt them to /switch back to a scope they can use.
      if (
        link.workspaceId &&
        !(await userIsWorkspaceMember(serverDB, link.userId, link.workspaceId))
      ) {
        await replyToSender(systemStrings.staleScope);
        return;
      }

      // Re-validate the active agent for the same reason: `activeAgentId` is
      // a long-lived binding that goes stale when the agent is deleted or
      // moved out of the active scope. Without this the run reaches the
      // agent runtime, `resolveAgentConfigOrThrow` throws `Agent not found`,
      // and the user gets a bare "Agent Execution Failed" with no operation
      // id and no way to recover — on every single message.
      if (
        !(await new AgentModel(serverDB, link.userId, link.workspaceId ?? undefined).existsById(
          link.activeAgentId,
        ))
      ) {
        log(
          'handle: active agent %s no longer resolves for user=%s workspace=%s',
          link.activeAgentId,
          link.userId,
          link.workspaceId,
        );
        await replyToSender(systemStrings.staleAgent);
        return;
      }

      const featureAccess = await getBotFeatureAccessState({
        action: 'runtime',
        platform,
        userId: link.userId,
        workspaceId: link.workspaceId ?? undefined,
      });
      if (!featureAccess.allowed) {
        await replyToSender(
          featureAccess.blockedMessage ??
            'This messenger connection requires a paid plan. Upgrade in LobeHub Settings to continue.',
        );
        return;
      }

      await dispatchToAgent(
        thread,
        message,
        client,
        link,
        link.activeAgentId,
        platform,
        bridgeMethod,
      );
    } catch (error) {
      log('handle: handler error: %O', error);
      try {
        await thread.post(
          renderInlineError(systemStrings.genericError, getBotReplyLocale(platform)),
        );
      } catch {
        /* ignore */
      }
    }
  };

  // We intentionally do NOT register `onDirectMessage`. Chat SDK
  // short-circuits the DM dispatch when that handler is registered
  // (`chat` core: `dispatchToHandlers` fires DM handlers and returns
  // before the `isSubscribed` check), which kills the subscription-based
  // routing that lets follow-up messages reuse the cached topicId.
  //
  // Without an `onDirectMessage` handler, chat-sdk forces `isMention =
  // true` for DMs and falls through to the standard subscription dispatch
  // (mirrors `BotMessageRouter`, which doesn't register `onDirectMessage`
  // either):
  //   - First DM → not subscribed yet → `onNewMention` →
  //     `handleMention` opens a topic and subscribes the thread.
  //   - Follow-up DM → subscribed → `onSubscribedMessage` →
  //     `handleSubscribedMessage` reads the cached topicId and continues.
  //
  // Track distinct humans who have spoken in a channel thread. A
  // single-user thread is effectively a private 1:1 with the bot (just
  // hosted in a channel), so we relax the @mention requirement and let
  // every follow-up reach the agent. Once a second human joins we revert
  // to mention-only mode and announce the switch once so newcomers
  // understand why follow-ups are suddenly silent.
  //
  // Tracking lives in chat-sdk state so the count survives webhook
  // boundaries (each Slack event delivery is a fresh request). DMs and
  // bot authors are excluded — DMs are already 1:1 and bots can't drive
  // a conversation.
  const PARTICIPANTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const participantsKey = (threadId: string): string => `messenger:thread-humans:${threadId}`;
  const mentionRequiredAnnouncedKey = (threadId: string): string =>
    `messenger:thread-mention-required-announced:${threadId}`;

  const trackThreadParticipant = async (
    thread: any,
    message: Message,
  ): Promise<{ count: number; isNewParticipant: boolean }> => {
    if (thread.isDM) return { count: 0, isNewParticipant: false };
    const senderId = message.author?.userId;
    const isHuman =
      !!senderId &&
      message.author?.isBot !== true &&
      (message.author as { isMe?: boolean })?.isMe !== true;
    if (!isHuman) return { count: 0, isNewParticipant: false };

    const stateAdapter = bot.getState();
    const key = participantsKey(thread.id);
    let participants: string[] = [];
    try {
      participants = (await stateAdapter.getList<string>(key)) ?? [];
    } catch (error) {
      log('trackThreadParticipant: getList failed: %O', error);
    }
    if (participants.includes(senderId)) {
      return { count: participants.length, isNewParticipant: false };
    }
    try {
      await stateAdapter.appendToList(key, senderId, {
        maxLength: 50,
        ttlMs: PARTICIPANTS_TTL_MS,
      });
    } catch (error) {
      log('trackThreadParticipant: appendToList failed: %O', error);
    }
    return { count: participants.length + 1, isNewParticipant: true };
  };

  bot.onSubscribedMessage(async (thread, message, context?: MessageContext) => {
    log('onSubscribedMessage: install=%s, msgId=%s', creds.installationKey, (message as any).id);

    // Fold in whatever the SDK collected while the previous handler ran (or
    // during a `burst` window) so the agent sees the whole user turn — text
    // and media alike — instead of only its last message.
    const merged = mergeBotMessages(message, context?.skipped);

    // DM short-circuit — always 1:1 with the bot, no participant gating.
    if (thread.isDM) {
      await handle(thread, merged, 'handleSubscribedMessage');
      return;
    }

    // A mention anywhere in the collected turn addresses the bot; the last
    // message of a burst often carries the question without the `@`.
    const isMention =
      message.isMention === true ||
      getSameSenderMessages(message, context?.skipped).some((m) => m.isMention === true) === true;
    let count = 0;
    for (const source of [...(context?.skipped ?? []), message]) {
      const participant = await trackThreadParticipant(thread, source);
      count = Math.max(count, participant.count);
    }

    // Single-human thread → respond without `@`. Multi-human thread →
    // only @mention triggers a reply, so the bot doesn't insert itself
    // into human-to-human chatter happening inside a thread it once
    // opened. `count === 0` covers tracking failures or bot authors —
    // fall through to `handle()` and let its existing `isBot` filter
    // drop bot messages.
    const shouldHandle = isMention || count <= 1;
    if (!shouldHandle) {
      // First skip in this thread → tell the room why the bot just went
      // quiet so participants know to @mention if they need it. Dedupe
      // by thread id so we never spam more than once. Feishu/Lark group
      // mains are already mention-only — skip the notice there.
      if (!isWholeGroupChatThreadId(thread.id)) {
        try {
          const fresh = await bot
            .getState()
            .setIfNotExists(mentionRequiredAnnouncedKey(thread.id), '1', PARTICIPANTS_TTL_MS);
          if (fresh) {
            await thread.post(
              "Multiple people are talking in this thread now. From here on I'll only respond when you @mention me.",
            );
          }
        } catch (error) {
          log('onSubscribedMessage: mention-mode announcement failed: %O', error);
        }
      }
      return;
    }

    // Follow-up on a subscribed thread (DM after the first touch, or a
    // subscribed channel thread). `handleSubscribedMessage` reads the
    // cached topicId from chat-sdk thread state and continues that topic;
    // it falls back to `handleMention` internally if no topicId is cached.
    await handle(thread, merged, 'handleSubscribedMessage');
  });

  // First-touch entry point for any non-subscribed conversation:
  //   - DMs (chat-sdk forces `isMention = true` for them — see the
  //     comment above).
  //   - Channel `@mention`s where the parent thread isn't subscribed yet.
  // `handleMention` opens a fresh topic, writes the topicId into chat-sdk
  // thread state, and (for subscribable platforms / threads — see
  // `client.shouldSubscribe`) subscribes the thread so subsequent
  // messages route through `onSubscribedMessage` and continue the topic.
  bot.onNewMention(async (thread, message, context?: MessageContext) => {
    log(
      'onNewMention: install=%s, msgId=%s, threadId=%s',
      creds.installationKey,
      (message as any).id,
      thread.id,
    );
    const merged = mergeBotMessages(message, context?.skipped);
    // Record the original @mentioner so the participant count starts at 1
    // (not 0) when their first follow-up lands in `onSubscribedMessage`.
    // Without this the follow-up looks like a "new participant" instead
    // of the same person continuing.
    for (const source of [...(context?.skipped ?? []), message]) {
      await trackThreadParticipant(thread, source);
    }
    await handle(thread, merged, 'handleMention');
  });

  // Native slash commands. chat-adapter routes a leading `/command` to the
  // slash-command channel (NOT onNewMention / onSubscribedMessage), so any
  // platform that surfaces slash commands MUST register here or the command
  // is silently dropped. Slack / Discord reply via `replyPrivately`; the
  // Telegram binder does not implement that helper, so register it explicitly
  // and fall back to `sendDmText` in the dispatcher. The full set of command
  // names comes from the shared registry so every platform surfaces the same menu.
  const supportsNativeSlashCommands =
    binder.replyPrivately !== undefined || creds.platform === 'telegram';
  if (supportsNativeSlashCommands) {
    const slashPaths = commands.map((cmd) => `/${cmd.name}`);
    bot.onSlashCommand(slashPaths, async (event) => {
      await handleSlashCommand(deps, { binder, bot, client, creds, event, serverDB });
    });
  }

  // Tap-action callbacks delivered via chat-sdk (Discord). Slack and
  // Telegram peek at the raw webhook body via `binder.extractCallbackAction`
  // in `getWebhookHandler` instead because their wire formats let us
  // short-circuit to a `200 OK` ack outside chat-sdk's request lifecycle.
  if (binder.extractActionFromEvent) {
    bot.onAction(async (event) => {
      try {
        const action = binder.extractActionFromEvent!(event, client);
        if (!action) return;
        await handleCallbackAction(deps, binder, creds, action, bot);
      } catch (error) {
        log('onAction handler error: %O', error);
      }
    });
  }

  // Channel-join welcome (Slack `member_joined_channel`). Counterpart to the
  // App Home `Messages`-tab welcome in `handleAppHomeOpened` — the marketplace
  // listing reviewers also test the `/invite @LobeHub` entry point, so the
  // bot must speak up the first time it lands in a channel. Other events
  // (regular members joining) are filtered out by the `botUserId` check.
  bot.onMemberJoinedChannel(async (event) => {
    const botUserId = (event.adapter as any)?.botUserId as string | undefined;
    if (!botUserId || event.userId !== botUserId) return;
    const channelId = client.extractChatId(event.channelId);
    if (!channelId) return;
    await handleChannelJoin(bot, binder, channelId);
  });
}

export async function dispatchToAgent(
  thread: any,
  message: Message,
  client: PlatformClient,
  link: SafeMessengerAccountLink,
  agentId: string,
  platform: MessengerPlatform,
  bridgeMethod: 'handleMention' | 'handleSubscribedMessage',
): Promise<void> {
  log(
    'dispatchToAgent: platform=%s, tenant=%s, sender=%s, agent=%s, user=%s',
    platform,
    link.tenantId,
    link.platformUserId,
    agentId,
    link.userId,
  );

  const serverDB = await getServerDB();
  const bridge = new AgentBridgeService(serverDB, link.userId, link.workspaceId ?? undefined);

  // Messenger account-link routing already binds platform sender →
  // LobeHub user; the dispatch only fires for the linked sender. So
  // `isOwner` is true iff the inbound message's `author.userId` matches
  // the linked `platformUserId`. `buildBotContext` enforces the
  // fail-closed default (never trust when either side is missing).
  //
  // `bridgeMethod` is chosen by the caller per entry point, mirroring
  // BotMessageRouter:
  // - `handleMention`           — first-touch DMs and channel @mentions;
  //                               opens a fresh topic and writes its id
  //                               to chat-sdk thread state.
  // - `handleSubscribedMessage` — DM follow-ups (after `thread.subscribe()`
  //                               in `onDirectMessage`); reads the cached
  //                               topicId and continues in the same topic.
  //                               Falls back to `handleMention` internally
  //                               if no topicId is cached (defensive).
  const bridgeOpts = {
    agentId,
    botContext: {
      ...buildBotContext({
        // Per-install applicationId so the agent runtime can distinguish
        // workspaces in its own bookkeeping (logs, traces, dedupe).
        applicationId: link.tenantId
          ? `messenger-${platform}-${link.tenantId}`
          : `messenger-${platform}`,
        authorUserId: message.author?.userId,
        operatorUserId: link.platformUserId,
        platform,
        platformThreadId: thread.id,
      }),
      // Explicit, deterministic marker that this run originated from the
      // shared Messenger bot. `BotCallbackService` uses the presence of this
      // field to resolve credentials via the messenger install store instead
      // of `agent_bot_providers` (which has no row for messenger flows).
      // Format matches `MessengerInstallationStore.resolveByKey` keys.
      messengerInstallationKey: link.tenantId
        ? `${platform}:${link.tenantId}`
        : `${platform}:singleton`,
    },
    client,
  };

  await bridge[bridgeMethod](thread, message, bridgeOpts);
}
