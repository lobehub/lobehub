import type { Chat, MessageContext } from 'chat';
import debug from 'debug';

import { getBotFeatureAccessState } from '@/business/server/bot/featureAccess';
import type { LobeChatDatabase } from '@/database/type';
import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { parseBotWakeSettings } from '@/server/services/agentSignal/scenarios/botWake/config';
import { isBotWakeEnabled } from '@/server/services/agentSignal/scenarios/botWake/gate';

import { AgentBridgeService } from '../AgentBridgeService';
import { buildBotContext } from '../buildBotContext';
import { isWholeGroupChatThreadId } from '../isWholeGroupChatThreadId';
import { getSameSenderMessages } from '../mergeMessages';
import {
  type BotReplyLocale,
  type DmSettings,
  extractDmSettings,
  extractGroupSettings,
  extractGuestSettings,
  extractUserAllowlist,
  extractWatchKeywordEntries,
  getBotReplyLocale,
  type GroupSettings,
  type GuestSettings,
  messageMatchesWatchKeyword,
  normalizeBotReactionMode,
  normalizeBotReplyLocale,
  type PlatformClient,
  type UserAllowlist,
} from '../platforms';
import { renderThrownAgentError } from '../renderThrownError';
import { createWakeClassify } from '../wake/classify';
import { createWakeIdentityLoader } from '../wake/identity';
import { resolveWakeScheduler } from '../wake/scheduler';
import type { WakeMessageLike } from '../wake/signal';
import { createAccessGate } from './accessGate';
import { registerCatchAllHandler } from './catchAll';
import { registerCommands } from './commands';
import { createFollowupGate, type FollowupGateDeps } from './followupGate';
import {
  createParticipantTracker,
  isSoloThreadConversation,
  mentionRequiredAnnouncedKey,
  PARTICIPANTS_TTL_MS,
} from './participants';
import type { BotCommand, ResolvedAgentInfo } from './types';
import {
  applyWatchKeywordInstructions,
  dispatchTextCommand,
  mergeSkippedMessages,
  summarizeMessageAttachments,
} from './utils';
import {
  type BotWakeEntryPoint,
  type BotWakeInitiation,
  botWakeKindFor,
  type BotWakeObservation,
  type BotWakeReason,
  createBotWakeRecorder,
} from './wakeDecision';

const log = debug('lobe-server:bot:message-router');

/**
 * Wire the Chat SDK handlers for one registered bot: @-mentions, subscribed
 * threads, slash / text commands and the DM / watch-keyword catch-all. Every
 * entry point shares one access gate (see `./accessGate`).
 */
export function registerHandlers(
  bot: Chat<any>,
  serverDB: LobeChatDatabase,
  client: PlatformClient,
  commands: BotCommand[],
  info: ResolvedAgentInfo & {
    applicationId: string;
    platform: string;
    settings?: Record<string, any>;
  },
  /** Reads the shared Redis client lazily (pairing codes). */
  getRedisClient: () => any,
): void {
  const { agentId, applicationId, platform, userId, workspaceId } = info;
  const bridge = new AgentBridgeService(serverDB, userId, workspaceId);
  const charLimit = (info.settings?.charLimit as number) || undefined;
  const displayToolCalls = info.settings?.displayToolCalls === true;
  const reactionMode = normalizeBotReactionMode(info.settings?.reactionMode);
  const dmSettings: DmSettings = extractDmSettings(info.settings);
  const guestSettings: GuestSettings = extractGuestSettings(info.settings);
  const groupSettings: GroupSettings = extractGroupSettings(info.settings);
  const userAllowlist: UserAllowlist = extractUserAllowlist(info.settings);
  /**
   * Operator-configured keywords (). When non-empty, a non-@mention
   * non-command message in a subscribed group thread still wakes the bot if
   * its text contains any keyword — case-insensitive, word-boundary aware
   * (see `messageMatchesWatchKeyword`). Empty list keeps the legacy
   * mention-only behaviour exactly. DMs and explicit mentions are unaffected;
   * keyword matching only relaxes the gate in subscribed group threads.
   *
   * `watchKeywordEntries` carries the operator-authored `instruction` for
   * each keyword. When a keyword (and not a mention) is what wakes the
   * bot, the matched entries' instructions are prepended to the user
   * message as a prompt prefix before dispatch — so a bare trigger word
   * can drive a specific directive ("scan the recent thread for a bug
   * report", "summarise the last 20 messages", …).
   */
  const watchKeywordEntries = extractWatchKeywordEntries(info.settings);
  const watchKeywords: ReadonlyArray<string> = watchKeywordEntries.map((e) => e.keyword);

  /**
   * Watch-keyword wakes ride on passive channel monitoring, which is a
   * gated feature (`messageMonitoring` — see the business featureAccess
   * slot). Checked lazily, only when a keyword (not a mention / DM /
   * command) is the sole wake reason, so access changes take effect on
   * the next message without any cache invalidation. Mentions, DMs,
   * replies, and commands never hit this gate.
   */
  const isMessageMonitoringAllowed = async (caller: string, threadId: string): Promise<boolean> => {
    const access = await getBotFeatureAccessState({
      action: 'runtime',
      applicationId,
      feature: 'messageMonitoring',
      platform,
      userId,
      workspaceId: workspaceId ?? undefined,
    });
    if (access.allowed) return true;
    log(
      '%s: watch-keyword wake dropped (messageMonitoring not allowed), agent=%s, platform=%s, thread=%s',
      caller,
      agentId,
      platform,
      threadId,
    );
    return false;
  };
  /**
   * The provider's owner platform user ID. Only consulted under the
   * `pairing` policy, where the gate gives the owner a free pass so they
   * can DM their own bot before any approvals exist (otherwise the
   * shouldHandleDm gate would tell the owner to ask themselves to
   * approve via `/approve`).
   */
  const operatorUserId =
    typeof info.settings?.userId === 'string'
      ? (info.settings.userId as string).trim() || undefined
      : undefined;
  const fallbackReplyLocale: BotReplyLocale = getBotReplyLocale(platform);

  /**
   * Resolve the reply locale for a single inbound event. Prefer the
   * sender's platform-reported locale (e.g. Telegram's
   * `from.language_code`) so a Brazilian Telegram user sees Portuguese,
   * even though Telegram's channel-level default is English. Fall back to
   * the platform default when the platform doesn't expose a locale or the
   * value is empty.
   */
  const detectReplyLocale = (message: { author?: unknown }): BotReplyLocale => {
    const detected = normalizeBotReplyLocale(client.extractAuthorLocale?.(message as any));
    return detected ?? fallbackReplyLocale;
  };

  const passGatesOrNotify = createAccessGate({
    agentId,
    applicationId,
    bot,
    client,
    dmSettings,
    getRedisClient,
    groupSettings,
    guestSettings,
    operatorUserId,
    platform,
    userAllowlist,
    userId,
    workspaceId,
  });

  /** Try dispatching a text command. Returns true if handled.
   *  Strips platform mention artifacts (e.g. Slack's `<@U123>`) before
   *  checking so that "@bot /new" correctly resolves to the /new command.
   *  Forwards the inbound `message.author` so commands that gate on
   *  identity (e.g. `/approve` requires the bot's owner) can verify. */
  const tryDispatch = async (
    thread: {
      id: string;
      post: (t: string) => Promise<any>;
      setState: (s: Record<string, any>, o?: { replace?: boolean }) => Promise<any>;
      state: Promise<Record<string, any> | null>;
    },
    text: string | undefined,
    author: { userId?: string; userName?: string } | undefined,
    replyLocale: BotReplyLocale,
    /**
     * `ungatedOnly` restricts dispatch to `bypassGate` commands. Callers
     * run it once BEFORE `passGatesOrNotify` (so `/whoami` answers even
     * when the sender would be rejected) and once after for the rest.
     */
    options?: { ungatedOnly?: boolean },
  ): Promise<boolean> => {
    const sanitized = client.sanitizeUserInput?.(text ?? '') ?? text;
    const result = dispatchTextCommand(sanitized, commands);
    if (!result) return false;
    if (options?.ungatedOnly && !result.command.bypassGate) return false;
    await result.command.handler({
      args: result.args,
      authorUserId: author?.userId,
      authorUserName: author?.userName,
      getState: () => thread.state,
      post: (t) => thread.post(t),
      replyLocale,
      setState: (s, o) => thread.setState(s, o),
      threadId: thread.id,
    });
    return true;
  };

  /** Returns true when the inbound passes the standard caller-test
   *  text. Used to short-circuit gate checks for non-command messages in
   *  subscribed group threads that aren't addressed to the bot. */
  const looksLikeCommand = (text: string | undefined): boolean => {
    const sanitized = client.sanitizeUserInput?.(text ?? '') ?? text;
    return dispatchTextCommand(sanitized, commands) !== null;
  };

  const trackThreadParticipants = createParticipantTracker(bot);

  // Observation only: records the decision each branch below already makes (see ./wakeDecision).
  const wakeRecorder = createBotWakeRecorder({
    agentId,
    applicationId,
    classify: createWakeClassify({
      agentId,
      db: serverDB,
      userId,
      workspaceId: workspaceId ?? undefined,
    }),
    db: serverDB,
    botNames: client.getBotNames && (async () => (await client.getBotNames!()) ?? []),
    identity: createWakeIdentityLoader({ agentId, db: serverDB, userId }),
    operatorUserId,
    platform,
    settings: info.settings,
    userId,
    workspaceId: workspaceId ?? undefined,
  });

  const observationOf = (
    entryPoint: BotWakeObservation['entryPoint'],
    message: WakeMessageLike,
    thread: { id: string },
    outcome: BotWakeObservation['outcome'],
    reason: BotWakeObservation['reason'],
    threadSubscribed = false,
  ): BotWakeObservation => ({
    entryPoint,
    message: {
      attachments: message.attachments,
      author: message.author,
      id: message.id,
      isMention: message.isMention,
      raw: message.raw,
      text: message.text,
    },
    outcome,
    reason,
    threadId: thread.id,
    threadSubscribed,
  });

  const observe = (
    entryPoint: BotWakeObservation['entryPoint'],
    message: WakeMessageLike,
    thread: { id: string },
    outcome: BotWakeObservation['outcome'],
    reason: BotWakeObservation['reason'],
    threadSubscribed = false,
  ) =>
    wakeRecorder.record(
      observationOf(entryPoint, message, thread, outcome, reason, threadSubscribed),
    );

  /**
   * Keeps what people said, everyone and not just the owner, in the channel's shared log so a later
   * judgement can read it. A whole burst at once: the SDK hands over the latest message and parks
   * the rest in `context.skipped`. Fire-and-forget; never throws.
   */
  const remember = (
    entryPoint: BotWakeEntryPoint,
    messages: WakeMessageLike[],
    thread: { id: string },
  ) => {
    for (const message of messages) {
      void wakeRecorder.remember(
        observationOf(entryPoint, message, thread, 'skip', 'not-addressed'),
      );
    }
  };

  /**
   * Records a skipped burst: the latest message with the same sender's earlier ones merged into
   * it (the text that was judged), and every other person's parked message as a decision of its
   * own, so what the bot did not answer is visible beside what it did.
   */
  const observeBurst = (
    entryPoint: BotWakeEntryPoint,
    message: Parameters<typeof mergeSkippedMessages>[0],
    context: MessageContext | undefined,
    thread: { id: string },
    threadSubscribed = false,
  ) => {
    const sameSender = new Set(getSameSenderMessages(message, context?.skipped));
    for (const other of context?.skipped ?? []) {
      if (!sameSender.has(other)) {
        observe(entryPoint, other, thread, 'skip', 'not-addressed', threadSubscribed);
      }
    }
    observe(
      entryPoint,
      mergeSkippedMessages(message, context),
      thread,
      'skip',
      'not-addressed',
      threadSubscribed,
    );
  };

  /**
   * Whether a message nobody addressed to the bot should wake it anyway: it says the bot's name,
   * or arrives in the follow-up window and the classifier agrees. Always `undefined` unless the
   * owner switched the rules to `enforce`. `message` is the burst merged, as it would run.
   */
  const initiate = (
    entryPoint: BotWakeEntryPoint,
    message: WakeMessageLike,
    thread: { id: string },
    threadSubscribed = false,
  ): Promise<BotWakeInitiation | undefined> =>
    wakeRecorder.initiate(
      observationOf(entryPoint, message, thread, 'skip', 'not-addressed', threadSubscribed),
    );

  const gateFollowup = createFollowupGate({
    applicationId,
    observe: observe as FollowupGateDeps['observe'],
    platform,
    recorder: wakeRecorder,
    scheduler: resolveWakeScheduler(platform, applicationId, info.settings),
  });

  bot.onNewMention(async (thread, message, context?: MessageContext) => {
    remember('onNewMention', [...(context?.skipped ?? []), message], thread);
    const replyLocale = detectReplyLocale(message);
    // Record the original @mentioner so the first follow-up in
    // `onSubscribedMessage` recognises them as participant #1 instead of
    // a "newcomer" — otherwise count would be 0 at that moment and the
    // single-user-relaxation logic wouldn't kick in.
    await trackThreadParticipants(thread, [...(context?.skipped ?? []), message]);

    // Side-effect-free `bypassGate` commands (`/whoami`) answer before the
    // gate so a not-yet-configured operator can discover their own ID.
    if (
      await tryDispatch(thread, message.text, message.author, replyLocale, {
        ungatedOnly: true,
      })
    ) {
      observe('onNewMention', message, thread, 'skip', 'command');
      return;
    }

    // Gate first — must run before tryDispatch so a /command from a
    // non-allowlisted sender can't slip through and side-effect.
    if (!(await passGatesOrNotify(thread, message.author, replyLocale, 'onNewMention'))) {
      observe('onNewMention', message, thread, 'skip', 'access-gate-rejected');
      return;
    }

    if (await tryDispatch(thread, message.text, message.author, replyLocale)) {
      observe('onNewMention', message, thread, 'skip', 'command');
      return;
    }

    log(
      'onNewMention raw: agent=%s, platform=%s, msgId=%s, textLen=%d, attachments=%o, skipped=%d',
      agentId,
      platform,
      message.id,
      message.text?.length ?? 0,
      summarizeMessageAttachments(message),
      context?.skipped?.length ?? 0,
    );
    if (context?.skipped?.length) {
      log(
        'onNewMention skipped messages: %o',
        context.skipped.map((m) => ({
          attachments: summarizeMessageAttachments(m),
          id: m.id,
          textLen: m.text?.length ?? 0,
        })),
      );
    }

    const merged = mergeSkippedMessages(message, context);
    observe(
      'onNewMention',
      merged,
      thread,
      'wake',
      thread.isDM ? 'direct-message' : 'explicit-mention',
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
      'onNewMention: agent=%s, platform=%s, author=%s, thread=%s, merged=%d, mergedAttachments=%d',
      agentId,
      platform,
      message.author.userName,
      thread.id,
      (context?.skipped?.length ?? 0) + 1,
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
      });
    } catch (error) {
      const operationId = AgentBridgeService.getActiveOperationId(thread.id);
      log(
        'onNewMention: unhandled error from handleMention: operationId=%s, %O',
        operationId,
        error,
      );
      try {
        await thread.post({ markdown: renderThrownAgentError(error, operationId, replyLocale) });
      } catch {
        // best-effort notification
      }
    }
  });

  bot.onSubscribedMessage(async (thread, message, context?: MessageContext) => {
    // Queue/debounce only dispatches the latest message as `message`; every
    // earlier arrival is preserved in `context.skipped`. Track all of them
    // before any early return so bot primaries and ignored chatter cannot
    // hide human participants from the mention-only transition.
    const { count: humanCount } = await trackThreadParticipants(thread, [
      ...(context?.skipped ?? []),
      message,
    ]);
    remember('onSubscribedMessage', [...(context?.skipped ?? []), message], thread);
    if (message.author.isBot === true) return;
    const replyLocale = detectReplyLocale(message);

    // Group / channel / thread policy: only respond when the bot is @-mentioned.
    // DMs are 1:1 conversations, so every message is implicitly addressed to the bot.
    // Without this guard, the bot would reply to every follow-up in a subscribed
    // thread — including messages between other users — and hijack the conversation.
    // Skipped (debounced) messages are also inspected so a mention queued behind a
    // non-mention still triggers a reply.
    //
    // Commands are exempt from the @-mention requirement (Telegram/Feishu users
    // type `/new` directly without mentioning the bot), but they are NOT exempt
    // from the access gates below.
    //
    // A conversation holding only the operator and this bot is a private 1:1
    // in all but name, so the @mention requirement is dropped there. Ask the
    // platform when it can answer from real membership; only fall back to
    // "how many distinct humans have SPOKEN here" when it can't.
    //
    // That fallback is a poor proxy and must not be trusted where the
    // subscribed thread is an entire group chat: silent members are never
    // counted, so a quiet 30-person group reads as private and the bot
    // answers everything the one talkative person says — including messages
    // @-ing a different bot. It survives only for platforms whose subscribed
    // threads really are narrow sub-conversations (Discord/Slack), where
    // speakers and participants are close to the same set.
    //
    // Participants are tracked either way so the announcement gate below can
    // still see the 1-human-vs-many transition.
    const isExplicitlyAddressed =
      thread.isDM ||
      message.isMention === true ||
      getSameSenderMessages(message, context?.skipped).some((m) => m.isMention === true) === true;
    // Only consult membership when it can change the outcome: a DM or an
    // @-mention is addressed to the bot regardless, and the platform lookup
    // behind `isSoloBotConversation` is a network round-trip whenever its
    // cache has lapsed — not something a direct message should wait on.
    const isSoloBotConversation =
      !isExplicitlyAddressed &&
      (await isSoloThreadConversation(
        humanCount,
        client.isSoloBotConversation && (() => client.isSoloBotConversation!(thread.id)),
      ));
    const isAddressedToBot = isExplicitlyAddressed || isSoloBotConversation;
    const platformReportsShared =
      !isExplicitlyAddressed && !!client.isSoloBotConversation && !isSoloBotConversation;
    const isCommand = looksLikeCommand(message.text);
    // operator-configured keyword match also wakes the bot in a
    // subscribed group thread. Skipped (debounced) siblings are inspected
    // too so a keyword queued behind a non-trigger still fires — same
    // pattern as the mention check above.
    const matchesWatchKeyword =
      watchKeywords.length > 0 &&
      (messageMatchesWatchKeyword(message.text, watchKeywords) ||
        getSameSenderMessages(message, context?.skipped).some((m) =>
          messageMatchesWatchKeyword(m.text, watchKeywords),
        ) === true);

    // Nobody addressed the bot. With the rules enforcing it may still speak up: its name is in the
    // text, or it spoke lately and the classifier agrees. Judged on the whole burst, as it would run.
    const initiation =
      !isAddressedToBot && !isCommand && !matchesWatchKeyword
        ? await initiate(
            'onSubscribedMessage',
            mergeSkippedMessages(message, context),
            thread,
            true,
          )
        : undefined;

    if (!isAddressedToBot && !isCommand && !matchesWatchKeyword && !initiation) {
      log(
        'onSubscribedMessage: skip non-mention in group thread, agent=%s, platform=%s, author=%s, thread=%s',
        agentId,
        platform,
        message.author.userName,
        thread.id,
      );
      // first skip in this thread → tell participants the bot
      // is now mention-only so newcomers don't think it broke. Dedupe by
      // thread id so we never announce more than once.
      if (
        !thread.isDM &&
        !isWholeGroupChatThreadId(thread.id) &&
        (humanCount >= 2 || platformReportsShared)
      ) {
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
      observeBurst('onSubscribedMessage', message, context, thread, true);
      return;
    }

    if ((matchesWatchKeyword || initiation) && !isAddressedToBot && !isCommand) {
      if (!(await isMessageMonitoringAllowed('onSubscribedMessage', thread.id))) {
        observe('onSubscribedMessage', message, thread, 'skip', 'monitoring-not-allowed', true);
        return;
      }
      log(
        'onSubscribedMessage: keyword match wakes bot, agent=%s, platform=%s, author=%s, thread=%s, keywords=%o',
        agentId,
        platform,
        message.author.userName,
        thread.id,
        watchKeywords,
      );
    }

    // Side-effect-free `bypassGate` commands (`/whoami`) answer before the
    // gate so a not-yet-configured operator can discover their own ID.
    if (
      await tryDispatch(thread, message.text, message.author, replyLocale, {
        ungatedOnly: true,
      })
    ) {
      observe('onSubscribedMessage', message, thread, 'skip', 'command', true);
      return;
    }

    // Gate before tryDispatch so a /command from a non-allowlisted sender
    // (or in a disabled DM/group scope) cannot side-effect.
    // A wake the bot started itself answers chatter nobody asked it to join: if the sender is not
    // allowed, drop it quietly rather than posting a rejection notice into the thread.
    const gateThread = initiation
      ? { id: thread.id, isDM: thread.isDM, post: async () => undefined }
      : thread;
    if (
      !(await passGatesOrNotify(gateThread, message.author, replyLocale, 'onSubscribedMessage'))
    ) {
      observe('onSubscribedMessage', message, thread, 'skip', 'access-gate-rejected', true);
      return;
    }

    if (await tryDispatch(thread, message.text, message.author, replyLocale)) {
      observe('onSubscribedMessage', message, thread, 'skip', 'command', true);
      return;
    }

    log(
      'onSubscribedMessage raw: agent=%s, platform=%s, msgId=%s, textLen=%d, attachments=%o, skipped=%d',
      agentId,
      platform,
      message.id,
      message.text?.length ?? 0,
      summarizeMessageAttachments(message),
      context?.skipped?.length ?? 0,
    );
    if (context?.skipped?.length) {
      log(
        'onSubscribedMessage skipped messages: %o',
        context.skipped.map((m) => ({
          attachments: summarizeMessageAttachments(m),
          id: m.id,
          textLen: m.text?.length ?? 0,
        })),
      );
    }

    let merged = mergeSkippedMessages(message, context);
    // when a keyword (and not a mention / DM / command) is what
    // wakes the bot, prepend the matched entries' operator-authored
    // instructions to the user message so the agent gets a directive
    // rather than only the raw chatter. Mentions, DMs, and commands are
    // skipped on purpose — those flows are user-initiated and should not
    // have an operator prompt silently injected on top.
    if (matchesWatchKeyword && !isAddressedToBot && !isCommand) {
      const applied = applyWatchKeywordInstructions(merged, watchKeywordEntries);
      merged = applied.merged;
      if (applied.instructionCount > 0) {
        log(
          'onSubscribedMessage: injecting %d watch-keyword instruction(s), agent=%s, platform=%s, thread=%s, prefixLen=%d',
          applied.instructionCount,
          agentId,
          platform,
          thread.id,
          applied.prefixLength,
        );
      }
    }
    const wakeReason: BotWakeReason = thread.isDM
      ? 'direct-message'
      : message.isMention === true || isExplicitlyAddressed
        ? 'explicit-mention'
        : isSoloBotConversation
          ? 'solo-conversation'
          : matchesWatchKeyword && !isCommand
            ? 'watch-keyword'
            : (initiation?.reason ?? 'addressed');
    // Only a wake nobody asked for may end in silence; a DM, @mention, command or solo
    // conversation is always answered, exactly as before. Until the bot-wake rollout reaches this
    // bot's owner nothing may: every wake is answered, as it was before the pipeline existed.
    const wakeKind = (await wakeRecorder.isRolledOut()) ? botWakeKindFor(wakeReason) : 'mention';
    if (
      wakeKind === 'followup' &&
      (await gateFollowup({
        entryPoint: 'onSubscribedMessage',
        merged,
        // Already judged by `initiate`: do not judge again. A message addressed to the bot does
        // not wait for the scheduler's collect window.
        immediate: initiation?.addressed,
        initiated: !!initiation,
        parked: [...(context?.skipped ?? []), message],
        thread,
        threadSubscribed: true,
      })) === 'stop'
    ) {
      return;
    }
    observe('onSubscribedMessage', merged, thread, 'wake', wakeReason, true);
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
      'onSubscribedMessage: agent=%s, platform=%s, author=%s, thread=%s, merged=%d, mergedAttachments=%d',
      agentId,
      platform,
      message.author.userName,
      thread.id,
      (context?.skipped?.length ?? 0) + 1,
      ((merged as any).attachments as unknown[] | undefined)?.length ?? 0,
    );

    try {
      await bridge.handleSubscribedMessage(thread, merged, {
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
        wakeKind,
      });
    } catch (error) {
      const operationId = AgentBridgeService.getActiveOperationId(thread.id);
      log(
        'onSubscribedMessage: unhandled error from handleSubscribedMessage: operationId=%s, %O',
        operationId,
        error,
      );
      try {
        await thread.post({ markdown: renderThrownAgentError(error, operationId, replyLocale) });
      } catch {
        // best-effort notification
      }
    }
  });

  // Register slash command handlers (native + text-based). The gate
  // helper is passed in so command paths share the access checks with
  // the message handlers — without this, a non-allowlisted sender could
  // /stop or /new and bypass the rest of the policy stack.
  registerCommands(
    bot,
    commands,
    client,
    {
      detectFromMessage: detectReplyLocale,
      fallback: fallbackReplyLocale,
    },
    passGatesOrNotify,
  );

  registerCatchAllHandler(bot, {
    agentId,
    applicationId,
    botWakeEnabled: isBotWakeEnabled(parseBotWakeSettings(info.settings).config),
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
    observeBurst,
    operatorUserId,
    passGatesOrNotify,
    platform,
    observe,
    remember,
    reactionMode,
    serverDB,
    userId,
    watchKeywordEntries,
    watchKeywords,
    workspaceId,
  });
}
