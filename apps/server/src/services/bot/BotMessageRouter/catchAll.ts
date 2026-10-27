import type { Chat, MessageContext } from 'chat';
import debug from 'debug';

import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';

import { buildBotContext } from '../buildBotContext';
import { getSameSenderMessages } from '../mergeMessages';
import { messageMatchesWatchKeyword } from '../platforms';
import { renderInlineError } from '../replyTemplate';
import type { BotHandlerContext } from './types';
import {
  applyWatchKeywordInstructions,
  dispatchTextCommand,
  mergeSkippedMessages,
  summarizeMessageAttachments,
} from './utils';

const log = debug('lobe-server:bot:message-router');

/** Register the DM / watch-keyword `onNewMessage(/./)` catch-all, when enabled. */
export const registerCatchAllHandler = (bot: Chat<any>, ctx: BotHandlerContext): void => {
  const {
    agentId,
    applicationId,
    botWakeEnabled,
    bridge,
    charLimit,
    client,
    commands,
    detectReplyLocale,
    displayToolCalls,
    dmSettings,
    gateFollowup,
    initiate,
    isMessageMonitoringAllowed,
    observe,
    observeBurst,
    operatorUserId,
    passGatesOrNotify,
    platform,
    reactionMode,
    remember,
    serverDB,
    userId,
    watchKeywordEntries,
    watchKeywords,
    workspaceId,
  } = ctx;

  // DM / keyword-wake catch-all: registered when either DM is enabled OR at
  // least one watch keyword is configured. The handler routes two distinct
  // paths through the same `onNewMessage(/./)` subscription so a single
  // regex listener can serve both:
  //
  //   • DM path: every message in a DM thread (when DM policy allows it).
  //   • Channel keyword path (): non-DM messages whose text — or
  //     a debounced sibling's text — contains a configured watch keyword.
  //     This is the only way to wake the bot in a parent channel on
  //     platforms like Discord, where `shouldSubscribe` returns false for
  //     top-level guild channels and `onSubscribedMessage` therefore never
  //     fires for the channel itself (only its sub-threads).
  //
  // Non-DM messages that DON'T match a keyword are silently dropped so the
  // regex doesn't hijack every group message in shared channels. Group
  // @-mentions keep going through `onNewMention` (unsubscribed) and
  // `onSubscribedMessage` (subscribed sub-threads).
  const dmCatchAllEnabled = dmSettings.policy !== 'disabled';
  const keywordCatchAllEnabled = watchKeywordEntries.length > 0;
  // A bot-wake bot also listens to channel chatter nobody addressed to it: its policies judge
  // those messages (shadow by default), so they must reach this handler.
  if (dmCatchAllEnabled || keywordCatchAllEnabled || botWakeEnabled) {
    bot.onNewMessage(/./, async (thread, message, context?: MessageContext) => {
      // Everyone's words, other bots' too, are context for a later judgement; never DMs (the
      // recorder refuses them) and never the bot's own.
      remember('catchAll', [...(context?.skipped ?? []), message], thread);
      if (message.author.isBot === true) return;

      // Skip text-based slash commands — already handled by registerCommands
      // (which applies the same gates).
      if (dispatchTextCommand(message.text, commands)) return;

      const isDM = thread.isDM === true;

      // Channel-side keyword wake: only relevant for non-DM threads, since
      // DMs already pass the gate below via `isDM`. Inspect the current
      // message AND any debounced siblings, mirroring `onSubscribedMessage`
      // so a keyword queued behind a non-trigger message still fires.
      const matchesWatchKeyword =
        !isDM &&
        keywordCatchAllEnabled &&
        (messageMatchesWatchKeyword(message.text, watchKeywords) ||
          getSameSenderMessages(message, context?.skipped).some((m) =>
            messageMatchesWatchKeyword(m.text, watchKeywords),
          ) === true);

      // If neither path applies, return so the regex doesn't act as a
      // channel-wide hijack. DMs still need the dmCatchAllEnabled gate
      // because a DM message can arrive while DM policy is disabled.
      let initiation: Awaited<ReturnType<typeof initiate>>;
      if (!(isDM && dmCatchAllEnabled) && !matchesWatchKeyword) {
        // Gated like every other passive listening path.
        if (
          !botWakeEnabled ||
          isDM ||
          !(await isMessageMonitoringAllowed(`onNewMessage (${platform} bot-wake)`, thread.id))
        ) {
          return;
        }

        // Nobody addressed the bot. With the rules enforcing it may still speak up: its name is in
        // the text, or it spoke lately and the classifier agrees. Otherwise this is observation only.
        initiation = await initiate('catchAll', mergeSkippedMessages(message, context), thread);
        if (!initiation) {
          observeBurst('catchAll', message, context, thread);
          return;
        }
      }

      if (matchesWatchKeyword) {
        if (
          !(await isMessageMonitoringAllowed(`onNewMessage (${platform} catch-all)`, thread.id))
        ) {
          observe('catchAll', message, thread, 'skip', 'monitoring-not-allowed');
          return;
        }
        log(
          'onNewMessage (%s catch-all): keyword match wakes bot in channel, agent=%s, author=%s, thread=%s, keywords=%o',
          platform,
          agentId,
          message.author.userName,
          thread.id,
          watchKeywords,
        );
      }

      const replyLocale = detectReplyLocale(message);

      // A wake the bot started itself answers chatter nobody asked it to join: if the sender is not
      // allowed, drop it quietly rather than posting a rejection notice into the channel.
      const gateThread = initiation
        ? { id: thread.id, isDM: thread.isDM, post: async () => undefined }
        : thread;
      if (
        !(await passGatesOrNotify(
          gateThread,
          message.author,
          replyLocale,
          `onNewMessage (${platform} catch-all)`,
        ))
      ) {
        observe('catchAll', message, thread, 'skip', 'access-gate-rejected');
        return;
      }

      log(
        'onNewMessage raw (%s catch-all): agent=%s, msgId=%s, textLen=%d, attachments=%o, skipped=%d',
        platform,
        agentId,
        message.id,
        message.text?.length ?? 0,
        summarizeMessageAttachments(message),
        context?.skipped?.length ?? 0,
      );
      if (context?.skipped?.length) {
        log(
          'onNewMessage skipped messages: %o',
          context.skipped.map((m) => ({
            attachments: summarizeMessageAttachments(m),
            id: m.id,
            textLen: m.text?.length ?? 0,
          })),
        );
      }

      let merged = mergeSkippedMessages(message, context);
      // same instruction-injection rule as `onSubscribedMessage`
      // — prepend the matched entries' operator-authored instructions when
      // the keyword (not a mention / DM / command) is what wakes the bot.
      // DMs are explicit user intent and never get the prefix.
      if (matchesWatchKeyword) {
        const applied = applyWatchKeywordInstructions(merged, watchKeywordEntries);
        merged = applied.merged;
        if (applied.instructionCount > 0) {
          log(
            'onNewMessage (%s catch-all): injecting %d watch-keyword instruction(s), agent=%s, thread=%s, prefixLen=%d',
            platform,
            applied.instructionCount,
            agentId,
            thread.id,
            applied.prefixLength,
          );
        }
      }

      if (matchesWatchKeyword || initiation) {
        // Last check before a keyword wake runs: enforced policies, then the scheduler. Before
        // the thread below is opened, so a parked message does not leave an empty thread behind.
        if (
          (await gateFollowup({
            entryPoint: 'catchAll',
            // Already judged by `initiate`: do not judge again. A message addressed to the bot
            // does not wait for the scheduler's collect window.
            immediate: initiation?.addressed,
            initiated: !!initiation,
            merged,
            parked: [...(context?.skipped ?? []), message],
            thread,
          })) === 'stop'
        ) {
          return;
        }

        // Discord (and any platform that prefers thread isolation) opts
        // into spawning a sub-thread for the reply via this hook. The
        // chat-sdk Discord adapter only auto-creates a thread on
        // @-mention, so without this the keyword wake would clutter the
        // parent channel with the bot's output. Best-effort: on hook
        // failure we keep the original thread.id and reply in the
        // channel rather than dropping the message.
        if (typeof client.openThreadForChannelWake === 'function') {
          try {
            const upgraded = await client.openThreadForChannelWake(
              thread.id,
              (message as { raw?: unknown }).raw,
            );
            if (upgraded && upgraded !== thread.id) {
              log(
                'onNewMessage (%s catch-all): opened reply thread for keyword wake, %s -> %s',
                platform,
                thread.id,
                upgraded,
              );
              (thread as { id: string }).id = upgraded;
            }
          } catch (error) {
            log(
              'onNewMessage (%s catch-all): openThreadForChannelWake threw, posting in channel: %O',
              platform,
              error,
            );
          }
        }
      }
      observe(
        'catchAll',
        merged,
        thread,
        'wake',
        initiation?.reason ?? (matchesWatchKeyword ? 'watch-keyword' : 'direct-message'),
      );
      void emitAgentSignalSourceEvent(
        {
          payload: {
            agentId,
            applicationId,
            platform,
            message: merged.text,
            platformThreadId: thread.id,
          },
          sourceId: merged.id,
          sourceType: 'bot.message.merged',
        },
        {
          agentId,
          db: serverDB,
          userId,
          workspaceId: workspaceId ?? undefined,
        },
        { ignoreError: true },
      );

      log(
        'onNewMessage (%s catch-all): agent=%s, author=%s, thread=%s, text=%s, mergedAttachments=%d',
        platform,
        agentId,
        message.author.userName,
        thread.id,
        message.text?.slice(0, 80),
        ((merged as any).attachments as unknown[] | undefined)?.length ?? 0,
      );

      try {
        await bridge.handleMention(thread, merged, {
          agentId,
          botContext: buildBotContext({
            applicationId,
            authorUserId: merged.author?.userId,
            operatorUserId,
            platform,
            platformThreadId: thread.id,
          }),
          charLimit,
          client,
          displayToolCalls,
          reactionMode,
          replyLocale,
          // A wake the bot started itself may end in silence (`NO_REPLY`) and holds back its
          // reactions and typing until it decides to speak.
          wakeKind: initiation ? 'followup' : undefined,
          proactive: initiation?.reason === 'proactive-help',
        });
      } catch (error) {
        log('onNewMessage: unhandled error from handleMention: %O', error);
        try {
          const errMsg = error instanceof Error ? error.message : String(error);
          await thread.post({ markdown: renderInlineError(errMsg, replyLocale) });
        } catch {
          // best-effort notification
        }
      }
    });
  }
};
