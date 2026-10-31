import type { Chat, SlashCommandEvent } from 'chat';
import debug from 'debug';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { AgentBridgeService } from '@/server/services/bot/AgentBridgeService';
import { submitBotFeedback } from '@/server/services/bot/feedbackSubmit';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { getBotReplyLocale } from '@/server/services/bot/platforms/const';
import {
  renderCommandReply,
  renderFeedbackSubmitted,
  renderModeStatus,
} from '@/server/services/bot/replyTemplate';

import type { InstallationCredentials } from '../installations/types';
import { getMessengerSystemStrings } from '../systemReply';
import type { MessengerPlatformBinder } from '../types';
import { runAgentsCommand, runSwitchCommand } from './agents';
import { modePickerEntries, resolveDefaultMode } from './mode';
import type { MessengerCommand, MessengerRouterDeps } from './types';
import { extractDiscordInteractionContext } from './utils';

const log = debug('lobe-server:messenger:router');

/**
 * Build the platform-agnostic command registry. Each entry is a single
 * function that handles every dispatch path (DM text, native slash, future
 * surfaces) — the `MessengerCommandContext` carries enough state for the
 * handler to make platform decisions on its own.
 *
 * To add a new command: append an entry here. It's automatically wired on
 * every platform whose binder declares it in `slashCommands.names` (or via
 * the text path on platforms without native slash support).
 */
export function buildCommands(deps: MessengerRouterDeps): MessengerCommand[] {
  return [
    {
      description: 'Bind your account to LobeHub',
      handler: async (ctx) => {
        const strings = getMessengerSystemStrings(ctx.platform);
        // Already-linked short-circuit: re-running `/start` while bound
        // would issue a fresh verify-im token and, on completion,
        // overwrite the user's `messenger_account_links` row via
        // `confirmLink` → `upsertForPlatform`. That desyncs the cached
        // chat-sdk thread state (topicId / agent runtime) from the new
        // active agent and the conversation hangs at "typing…" with no
        // reply. Treat `/start` as the unbound-only onboarding command.
        if (ctx.link) {
          await ctx.reply(strings.accountAlreadyLinked);
          return;
        }
        // The verify-im URL is one-shot and account-binding; it must reach
        // the invoker privately. Two equally-private surfaces depending on
        // the platform:
        //   • Slack — `chat.postEphemeral` in the channel is invoker-only
        //     and keeps the link flow inline (no DM context switch).
        //   • Discord — no text-channel ephemeral primitive for non-
        //     interaction messages, so we still open a DM.
        // Telegram group `/start` is intercepted by `handleSlashCommand`
        // before this handler and gets a safe prompt to open the bot DM.
        // Detection key: presence of `binder.replyEphemeral`, which is what
        // the @mention path also uses to decide ephemeral-vs-DM.
        const canEphemeralInChannel = !ctx.isDM && !!ctx.binder.replyEphemeral;
        const linkChatId = ctx.isDM || canEphemeralInChannel ? ctx.chatId : ctx.authorUserId;
        // `slack:<channel>:` (empty threadTs) — slash commands fire outside
        // any thread, so the ephemeral floats inline at the channel root,
        // which is what we want.
        const channelMentionThreadId = canEphemeralInChannel
          ? `${ctx.platform}:${ctx.chatId}:`
          : undefined;
        await ctx.binder.handleUnlinkedMessage({
          authorUserId: ctx.authorUserId,
          authorUserName: ctx.authorUserName,
          channelMentionThreadId,
          chatId: linkChatId,
          message: ctx.message,
        });
        // Only nudge the user toward DM when the link actually went there.
        // For the Slack ephemeral path the prompt is already inline, a
        // second "check your DM" would be misleading.
        if (!ctx.isDM && !canEphemeralInChannel && ctx.interactiveReplies) {
          await ctx.reply(strings.checkDirectMessage);
        }
      },
      name: 'start',
    },
    {
      description: 'List agents and switch the active one',
      handler: async (ctx) => {
        await runAgentsCommand(deps, ctx);
      },
      name: 'agents',
    },
    {
      description: 'Switch the active scope (personal or a workspace)',
      // Declared so Discord/Slack surface a `/switch <n>` argument in the
      // slash picker; the no-arg form just lists the scopes.
      options: [
        {
          description: 'Scope number from the /switch list',
          name: 'scope',
          required: false,
        },
      ],
      handler: async (ctx) => {
        await runSwitchCommand(deps, ctx);
      },
      name: 'switch',
    },
    {
      description: 'Start a new conversation',
      handler: async (ctx) => {
        const strings = getMessengerSystemStrings(ctx.platform);
        if (!ctx.link) {
          await ctx.reply(strings.needLink);
          return;
        }
        if (!ctx.thread) {
          // Slash dispatch has no chat-sdk Thread; setState lives on the
          // thread instance, so direct the user back to the DM where the
          // text path can pick the command up.
          await ctx.reply(strings.newDirectMessageOnly);
          return;
        }
        // Drop the cached topicId so the next message starts a fresh topic.
        // Mirrors `/new` in the bot router (BotMessageRouter.buildCommands):
        // `replace: true` is what reliably clears topicId (a merged
        // `undefined` is dropped by the JSON round-trip), while the `/mode`
        // choice is carried over — it's a conversation preference, and
        // starting a new topic shouldn't silently revert it.
        try {
          const toolMode = (await ctx.thread.state)?.toolMode;
          await ctx.thread.setState(
            toolMode ? { toolMode, topicId: undefined } : { topicId: undefined },
            { replace: true },
          );
        } catch (error) {
          log('command /new: setState failed: %O', error);
        }
        await ctx.reply(strings.newStarted);
      },
      name: 'new',
    },
    {
      description: 'Show or switch the conversation mode (agent | chat)',
      // Declared so Discord/Slack surface a `/mode <mode>` argument in the
      // slash picker; the no-arg form shows the current mode.
      options: [
        {
          description: "Target mode: 'agent' or 'chat'; omit to show the current mode",
          name: 'mode',
          required: false,
        },
      ],
      handler: async (ctx) => {
        const replyLocale = getBotReplyLocale(ctx.platform);
        const strings = getMessengerSystemStrings(ctx.platform);
        if (!ctx.link) {
          await ctx.reply(strings.needLink);
          return;
        }
        if (!ctx.thread) {
          // Mode lives in chat-sdk thread state; without a resolved DM
          // thread there is nothing to read or write. Mirrors `/new`.
          await ctx.reply(strings.modeDirectMessageOnly);
          return;
        }
        const arg = ctx.args.trim().toLowerCase();
        if (!arg) {
          let override: 'agent' | 'chat' | undefined;
          try {
            const state = await ctx.thread.state;
            override =
              state?.toolMode === 'agent' || state?.toolMode === 'chat'
                ? state.toolMode
                : undefined;
          } catch (error) {
            log('command /mode: read state failed: %O', error);
          }
          // No explicit override → surface the EFFECTIVE mode (the active
          // agent's configured default) so the picker always carries a
          // current-mode mark instead of showing two unmarked buttons.
          const current = override ?? (await resolveDefaultMode(ctx.serverDB, ctx.link));
          // Tap-to-switch picker on platforms with button support (mirrors
          // /agents); buttons emit `messenger:mode:<agent|chat>`. Platforms
          // without a picker fall back to the text status + usage reply.
          // Only offered where a tap writes the same thread this invocation
          // resolved: DMs, and slash dispatches (whose ctx.thread IS the
          // canonical DM that handleModeCallback writes via openDM). A
          // channel text mention resolves the CHANNEL thread — picker taps
          // would write the DM while this channel's next run reads its own
          // state — so it gets the text status instead.
          if (
            ctx.interactiveReplies &&
            ctx.binder.sendAgentPicker &&
            (ctx.isDM || ctx.source === 'slash')
          ) {
            await ctx.binder.sendAgentPicker(ctx.chatId, {
              action: 'mode',
              entries: modePickerEntries(current, strings),
              // Channel invocation → ephemeral so the picker doesn't
              // broadcast; DMs stay non-ephemeral so it persists in history.
              ephemeralTo: ctx.isDM ? undefined : ctx.authorUserId,
              interaction: ctx.interaction,
              text: strings.modePicker,
            });
            return;
          }
          await ctx.reply(renderModeStatus(current, replyLocale));
          return;
        }
        if (arg !== 'agent' && arg !== 'chat') {
          await ctx.reply(renderCommandReply('cmdModeUsage', replyLocale));
          return;
        }
        try {
          await ctx.thread.setState({ toolMode: arg });
        } catch (error) {
          log('command /mode: setState failed: %O', error);
          await ctx.reply(strings.genericError);
          return;
        }
        await ctx.reply(
          renderCommandReply(arg === 'agent' ? 'cmdModeSetAgent' : 'cmdModeSetChat', replyLocale),
        );
      },
      name: 'mode',
    },
    {
      description: 'Stop the current execution',
      handler: async (ctx) => {
        const strings = getMessengerSystemStrings(ctx.platform);
        if (!ctx.link) {
          await ctx.reply(strings.needLink);
          return;
        }
        if (!ctx.thread) {
          await ctx.reply(strings.stopDirectMessageOnly);
          return;
        }
        const isActive = AgentBridgeService.isThreadActive(ctx.thread.id);
        if (!isActive) {
          await ctx.reply(strings.stopNotActive);
          return;
        }
        const operationId = AgentBridgeService.getActiveOperationId(ctx.thread.id);
        if (operationId) {
          try {
            const aiAgentService = new AiAgentService(ctx.serverDB, ctx.link.userId, {
              workspaceId: ctx.link.workspaceId ?? undefined,
            });
            const result = await aiAgentService.interruptTask({ operationId });
            if (!result.success) {
              log('command /stop: runtime interrupt rejected for op=%s', operationId);
              await ctx.reply(strings.stopUnable);
              return;
            }
            AgentBridgeService.clearActiveThread(ctx.thread.id);
            log('command /stop: interrupted op=%s', operationId);
          } catch (error) {
            log('command /stop: interruptTask failed: %O', error);
            await ctx.reply(strings.stopUnable);
            return;
          }
        } else {
          // execAgent hasn't returned an operationId yet — queue the stop so
          // it fires the moment startup completes.
          AgentBridgeService.requestStop(ctx.thread.id);
          log('command /stop: queued deferred stop for thread=%s', ctx.thread.id);
        }
        await ctx.reply(strings.stopRequested);
      },
      name: 'stop',
    },
    {
      description: 'Send feedback directly to the LobeHub team (no AI reply)',
      // Declaring the argument so Discord/Slack surface a `/feedback <message>`
      // prompt; without it the slash picker registers the command as zero-arg
      // and the user can't enter feedback text from the picker UI.
      options: [
        {
          description: 'Your feedback message',
          name: 'message',
          required: true,
        },
      ],
      handler: async (ctx) => {
        const replyLocale = getBotReplyLocale(ctx.platform);
        const strings = getMessengerSystemStrings(ctx.platform);
        // Feedback is tied to a LobeHub account so the team can follow up;
        // an unbound user has no email/identity to attach. Mirror the
        // `/new` / `/stop` "you need to /start" guard for consistency.
        if (!ctx.link) {
          await ctx.reply(strings.needLink);
          return;
        }
        const body = ctx.args.trim();
        if (!body) {
          await ctx.reply(renderCommandReply('cmdFeedbackUsage', replyLocale));
          return;
        }
        const result = await submitBotFeedback(ctx.serverDB, {
          body,
          platform: ctx.platform,
          threadId: ctx.thread?.id ?? ctx.chatId,
          userId: ctx.link.userId,
        });
        if (!result.success) {
          await ctx.reply(renderCommandReply('cmdFeedbackError', replyLocale));
          return;
        }
        await ctx.reply(renderFeedbackSubmitted(result.issueUrl, replyLocale));
      },
      name: 'feedback',
    },
    {
      description: 'Show usage',
      handler: async (ctx) => {
        await ctx.reply(getMessengerSystemStrings(ctx.platform).help);
      },
      name: 'help',
    },
  ];
}

/**
 * Native slash command dispatcher. Delegates to the shared command registry
 * after wrapping the chat-sdk slash event in a `MessengerCommandContext`.
 * Each binder supplies its own `reply` mechanism (ephemeral on Slack,
 * regular DM message on Discord) so the handler stays platform-agnostic.
 */
export async function handleSlashCommand(
  deps: MessengerRouterDeps,
  params: {
    binder: MessengerPlatformBinder;
    bot: Chat<any>;
    client: PlatformClient;
    creds: InstallationCredentials;
    event: SlashCommandEvent;
    serverDB: LobeChatDatabase;
  },
): Promise<void> {
  const { binder, bot, client, creds, event, serverDB } = params;
  const senderId = event.user.userId;
  if (!senderId) {
    log('handleSlashCommand: missing user id, dropping');
    return;
  }

  // `event.command` is the literal `/foo` the platform sent.
  const cmdName = event.command.replace(/^\//, '').toLowerCase();
  // chat-sdk wraps the raw channel id with the platform prefix
  // (e.g. `slack:<channel>`, `discord:guild:channel:thread`); strip back to
  // the bare id so direct platform API calls see what they expect.
  const chatId = client.extractChatId((event.channel as any).id as string);
  const args = event.text?.trim() ?? '';
  const isTelegramGroup = creds.platform === 'telegram' && chatId.startsWith('-');
  const replyChatId = isTelegramGroup ? senderId : chatId;

  // Slack / Discord reply privately (ephemeral / DM); Telegram has no
  // `replyPrivately`, so fall back to a direct message in the slash
  // command's chat. Both keep the reply scoped to the invoker.
  const replyPrivately = binder.replyPrivately;
  const reply = replyPrivately
    ? (text: string) => replyPrivately.call(binder, event.channel, event.user, text)
    : (text: string) => binder.sendDmText(replyChatId, text);
  const systemStrings = getMessengerSystemStrings(creds.platform);

  const command = deps.getCommandsForPlatform(creds.platform).find((c) => c.name === cmdName);
  if (!command) {
    await reply(systemStrings.unknownCommand(cmdName));
    return;
  }

  const link = await MessengerAccountLinkModel.findByPlatformUser(
    serverDB,
    creds.platform,
    senderId,
    creds.tenantId,
  );

  // Telegram bots cannot initiate a private conversation with a user. A
  // first-time user invoking `/start` from a group therefore cannot receive
  // the account-link button at `senderId`. Keep the one-shot link out of the
  // group and post only a safe instruction back to the originating chat (or
  // forum topic); the user can then open the bot DM and retry `/start`.
  if (isTelegramGroup && cmdName === 'start' && !link) {
    await event.channel.post(systemStrings.startDirectMessageOnly);
    return;
  }

  // Slash command events have no chat-sdk Thread attached (slash isn't
  // posted into any specific thread). Worse, chat-sdk's
  // `handleSlashCommandEvent` constructs the ChannelImpl WITHOUT an
  // `isDM` flag — it defaults to `false`, so we can't even tell
  // whether the slash was fired from a DM by inspecting the channel.
  //
  // Resolve the user's DM thread on every slash invocation so commands
  // like `/new` and `/stop` always have a target (the user's canonical
  // bot conversation). `bot.openDM(userId)` is idempotent — Slack's
  // `conversations.open` returns the existing IM when one already
  // exists, so this doesn't create new conversations on each call. If
  // resolution fails (rate limit, permission), `thread` stays undefined
  // and handlers fall back to their "open your DM" branch.
  let thread: any | undefined;
  try {
    thread = await bot.openDM(senderId);
  } catch (error) {
    log('handleSlashCommand: openDM(%s) failed: %O', senderId, error);
  }

  // chat-sdk doesn't propagate `isDM` on slash-event Channels (see the
  // openDM block above). Fall back to a Slack channel-id prefix probe:
  // raw Slack ids that start with `D` are 1:1 DMs (`G` / `MPDM` are
  // group DMs, `C` is public). For other platforms (Discord today) the
  // chat-sdk flag is reliable so we keep that path too.
  const isDmChannel =
    event.channel.isDM === true ||
    (creds.platform === 'slack' && chatId.startsWith('D')) ||
    (creds.platform === 'telegram' && !isTelegramGroup);

  // Discord slash commands arrive as deferred interactions (the
  // `patchDiscordForwardedInteractions` patch ack's them with type 5
  // before dispatch). The interaction token in `event.raw` is the only
  // way handlers can complete that deferred state via the webhook
  // follow-up endpoint — without it, Discord keeps spinning "Thinking..."
  // and eventually flips to "did not respond". Other platforms have no
  // analogous concept, so the field stays undefined.
  const interaction = extractDiscordInteractionContext(creds.platform, event);

  try {
    await command.handler({
      args,
      authorUserId: senderId,
      authorUserName: event.user.userName,
      binder,
      chatId: replyChatId,
      interaction,
      interactiveReplies: true,
      // `isDM` lets handlers like `/agents` keep the picker public in
      // DMs (so it stays in history) and widen to an ephemeral when
      // the slash was typed from a public channel.
      isDM: isDmChannel,
      link,
      platform: creds.platform,
      reply,
      serverDB,
      source: 'slash',
      tenantId: creds.tenantId,
      thread,
    });
  } catch (error) {
    log('handleSlashCommand: handler error for /%s: %O', cmdName, error);
    try {
      await reply(systemStrings.genericError);
    } catch {
      /* ignore */
    }
  }
}
