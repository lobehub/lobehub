import { MessageApiName } from '@lobechat/builtin-tool-message';
import type { BotPlatformContext } from '@lobechat/context-engine';
import type { BotWakeKind, ChatTopicBotContext } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';
import debug from 'debug';

import type { MessengerPlatform } from '@/config/messenger';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { AiAgentService } from '@/server/services/aiAgent';
import { GatewayService } from '@/server/services/gateway';
import { getMessageGatewayClient } from '@/server/services/gateway/MessageGatewayClient';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import { buildBotSender, formatPrompt as formatPromptUtil } from '../formatPrompt';
import type { BotReactionMode, BotReplyLocale, PlatformClient } from '../platforms';
import { platformFromThreadId, platformRegistry } from '../platforms';
import { resolveUnsupportedMessageApis } from '../platforms/messageCapabilities';
import { buildRecentChannelHistory } from '../recentChannelHistory';
import { renderStart } from '../replyTemplate';
import { resolveFiles } from './inbound';
import { executeWithHooksLocalMode } from './localMode';
import { executeWithHooksQueueMode } from './queueMode';
import type {
  BridgeExecutionDeps,
  BridgeExecutionResult,
  DiscordChannelContext,
  ThreadState,
} from './types';
import { resolveCurrentChannel, safeSideEffect } from './utils';

const log = debug('lobe-server:bot:agent-bridge');

/**
 * Format user message into agent prompt.
 * Delegates to the standalone formatPrompt utility.
 */
export function formatPrompt(message: Message, client?: PlatformClient): string {
  return formatPromptUtil(message as any, {
    resolveMentions: client?.resolveMentions?.bind(client),
    sanitizeUserInput: client?.sanitizeUserInput?.bind(client),
  });
}

/**
 * Execute agent with unified hooks — auto-adapts to local or queue mode.
 *
 * Local mode: hooks run in-process, Promise resolves when agent completes.
 * Queue mode: hooks deliver via webhooks, returns immediately after startup.
 */
export async function executeWithCallback(
  deps: BridgeExecutionDeps,
  thread: Thread<ThreadState>,
  userMessage: Message,
  opts: {
    agentId: string;
    botContext?: ChatTopicBotContext;
    /** The bot's settings; local mode records the bot-wake outcome with them. */
    botSettings?: Record<string, unknown>;
    channelContext?: DiscordChannelContext;
    charLimit?: number;
    client?: PlatformClient;
    displayToolCalls?: boolean;
    /** The message falls within the bot's duties; told to the agent with a `followup`. */
    duty?: { matched?: string };
    /** The bot woke in its follow-up window; told to the agent with a `followup`. */
    followup?: BotPlatformContext['followup'];
    /** The bot woke only because its name is in the text; told to the agent with a `followup`. */
    named?: boolean;
    /** Emoji the owner lets the bot use in this conversation. */
    replyEmojis?: { emoji: string; usage?: string }[];
    /** How the bot talks in this conversation, as the owner wrote it. */
    replyStyle?: string;
    /** Acknowledgement posted before the run; the agent is told not to repeat it. */
    openingReply?: string;
    reactionMode?: BotReactionMode;
    replyLocale: BotReplyLocale;
    /** The agent may step back from this conversation; documented in its prompt. */
    standDown?: boolean;
    topicId?: string;
    trigger?: string;
    /** `followup` holds visible feedback back until the agent starts acting. Default `mention`. */
    wakeKind?: BotWakeKind;
  },
): Promise<BridgeExecutionResult> {
  // Resolve bot platform context from platform registry. Messenger-only
  // platforms (Linq) have no bot-channel definition and carry the same reply
  // traits on their messenger definition instead.
  const platformDef = opts.botContext?.platform
    ? (platformRegistry.getPlatform(opts.botContext.platform) ??
      messengerPlatformRegistry.getPlatform(opts.botContext.platform))
    : undefined;
  // Platforms whose runtime rejects `readMessages` (e.g. WeChat) can't fetch
  // history on demand. We flag that so the prompt stops telling the model to
  // call `readMessages`, and instead pre-inject recent same-channel history
  // below (see `buildRecentChannelHistory`). Guest Telegram summons use the
  // guest overlay (no channel tools, including history).
  const canReadHistory = !resolveUnsupportedMessageApis(
    opts.botContext?.platform,
    opts.botContext?.platformThreadId,
  )?.includes(MessageApiName.readMessages);
  // The `channelId` the model must pass to `lobe-message` to act on THIS
  // conversation. `extractChatId` is the same decoder each platform client
  // already uses for its own outbound calls, so the injected value is exactly
  // what the message service expects (Feishu `oc_…`, Discord channel/thread
  // id, Slack channel id). Without it `readMessages` — whose `channelId` is
  // required, and which most platforms have no `listChannels` to discover —
  // is unusable, and the model falls back to asking the user for a group ID.
  const currentChannel = resolveCurrentChannel(opts.botContext, opts.client);
  const botPlatformContext: BotPlatformContext | undefined = platformDef
    ? {
        canReadHistory,
        ...(currentChannel && { currentChannel }),
        platformName: platformDef.name,
        supportsMarkdown: platformDef.supportsMarkdown !== false,
      }
    : undefined;
  // Whether we can edit a previously-posted message in place. When false
  // (QQ/WeChat today), the chat-adapter falls editMessage back to postMessage,
  // so each step/completion edit surfaces as a NEW message — leaving the
  // placeholder stranded and the final reply duplicated. We still post an ack
  // so the user gets immediate feedback, but skip tracking it as
  // `progressMessage` so downstream hooks post the final reply fresh instead
  // of editing the placeholder.
  const supportsMessageEdit = platformDef?.supportsMessageEdit !== false;

  const {
    agentId,
    botContext,
    channelContext,
    charLimit,
    client,
    displayToolCalls,
    reactionMode,
    replyLocale,
    topicId,
    trigger,
    wakeKind = 'mention',
  } = opts;
  const deferFeedback = wakeKind === 'followup';

  // For platforms that can't read history at runtime, surface a compact
  // cross-session summary of this channel (recent topics, each with its last
  // user message) so a fresh topic still knows what was just discussed.
  //
  // Only injected when this run OPENS a new topic (`topicId` is absent —
  // a fresh mention, or a follow-up whose topic went stale). Once the
  // conversation continues inside that topic, its own messages are the
  // context; re-injecting prior sessions every turn just burns tokens and
  // competes with the live history. Scoped to the channel via
  // `platformThreadId`; best-effort — never block the reply.
  if (botPlatformContext && !canReadHistory && !topicId && botContext?.platformThreadId) {
    try {
      botPlatformContext.recentChannelHistory = await buildRecentChannelHistory(
        deps.db,
        deps.userId,
        deps.workspaceId,
        { platformThreadId: botContext.platformThreadId },
      );
    } catch (error) {
      log('executeWithWebhooks: buildRecentChannelHistory failed (non-fatal): %O', error);
    }
  }

  // Per-conversation mode switch (`/mode agent|chat`). Read from thread
  // state on every run so both fresh mentions and follow-ups honour it;
  // best-effort — a transient state-store error falls back to the agent's
  // configured default rather than blocking the reply.
  let toolModeOverride: ThreadState['toolMode'];
  try {
    toolModeOverride = (await thread.state)?.toolMode;
  } catch (error) {
    log('executeWithCallback: failed to read thread state for toolMode: %O', error);
  }

  const queueMode = isQueueAgentRuntimeEnabled();
  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const timezone = await deps.loadTimezone();

  // Make sure the person who triggered the run is a member of the reply
  // thread, so the platform notifies them when the reply lands (
  // Discord's auto-created mention threads never add the mentioning user,
  // and pill rendering on the origin message proved unreliable — replies
  // were delivered but nobody was told). Fire-and-forget; never blocks.
  const senderPlatformId = userMessage.author?.userId;
  if (client?.ensureThreadMember && botContext?.platformThreadId && senderPlatformId) {
    void safeSideEffect(
      () => client.ensureThreadMember!(botContext.platformThreadId!, senderPlatformId),
      'ensureThreadMember (executeWithCallback)',
    );
  }

  // When the message-gateway is configured AND the platform supports typing
  // indicators, skip the ack/progress message and rely on the gateway's
  // alarm-based typing indicator throughout AI generation.
  // Posting an ack message cancels platform-level typing (e.g. Discord), and the
  // gateway typing makes ack redundant as user feedback.
  // For platforms without typing support (no triggerTyping on messenger), the
  // gateway typing is invisible, so we still send an ack message as user feedback.
  const botPlatform = platformFromThreadId(botContext?.platformThreadId);
  const gwClient = getMessageGatewayClient(botPlatform);
  const platformSupportsTyping =
    client && botContext?.platformThreadId
      ? !!client.getMessenger(botContext.platformThreadId).triggerTyping
      : true;
  const useGatewayTyping = gwClient.isEnabled && platformSupportsTyping;

  /**
   * Everything the user can see while the agent works: platform typing, the gateway's typing
   * alarm, and the "working on it" placeholder. A `mention` runs it before the agent starts; a
   * `followup` hands it to the execution mode to run once the agent starts acting, so a silent
   * run leaves no trace.
   */
  const showFeedback = async (): Promise<{
    gatewayConnectionId?: string;
    progressMessage?: SentMessage;
  }> => {
    let progressMessage: SentMessage | undefined;
    let gatewayConnectionId: string | undefined;
    if (useGatewayTyping) {
      log('executeWithWebhooks: using gateway typing, skipping ack message');

      // Platform typing (best-effort, must not block AI generation)
      await safeSideEffect(() => thread.startTyping(), 'startTyping (executeWithWebhooks)');

      // Start gateway typing immediately so the alarm keeps it alive through
      // the entire AI generation (platform typing expires after ~10s).
      if (botContext?.platformThreadId && botContext?.applicationId) {
        const platform = platformFromThreadId(botContext.platformThreadId);
        try {
          if (botContext.messengerInstallationKey) {
            // Messenger run: shard typing by `(platform, lobeUserId)` so each
            // user gets their own DO. Solves both the cross-conversation
            // TypingState overwrite bug (single shared DO) and the 200K-MAU
            // single-DO hot-spot. The connectionId is registered lazily and
            // cached per-process — see GatewayService.ensureUserMessengerConnected.
            const gateway = new GatewayService();
            const connectionId = await gateway.ensureUserMessengerConnected({
              installationKey: botContext.messengerInstallationKey,
              platform: platform as MessengerPlatform,
              userId: deps.userId,
            });
            if (connectionId) {
              gatewayConnectionId = connectionId;
              gwClient.startTyping(connectionId, botContext.platformThreadId!).catch((err) => {
                log('executeWithWebhooks: messenger gateway startTyping failed: %O', err);
              });
            }
          } else {
            // Per-agent bot provider: typing keyed by the provider row id —
            // legacy path for `agent_bot_providers`-backed bots.
            const row = await AgentBotProviderModel.findByPlatformAndAppId(
              deps.db,
              platform,
              botContext.applicationId,
            );
            if (row?.id) {
              gatewayConnectionId = row.id;
              gwClient.startTyping(row.id, botContext.platformThreadId!).catch((err) => {
                log('executeWithWebhooks: gateway startTyping failed: %O', err);
              });
            }
          }
        } catch (err) {
          log('executeWithWebhooks: gateway provider lookup failed: %O', err);
        }
      }
    } else if (!supportsMessageEdit) {
      // Edit-incapable platform (QQ today): the user still wants immediate
      // feedback that we received their message, but every "edit" the
      // adapter performs surfaces as a NEW message. So fire-and-forget the
      // ack here without tracking it as `progressMessage` — afterStep/onComplete
      // will see `progressMessage === undefined` and correctly post the final
      // reply as its own message instead of editing.
      await safeSideEffect(() => thread.startTyping(), 'startTyping (executeWithWebhooks)');
      await safeSideEffect(
        () => thread.post(renderStart(userMessage.text, { lng: replyLocale, timezone })),
        'post ack (no-edit platform)',
      );
    } else {
      await safeSideEffect(() => thread.startTyping(), 'startTyping (executeWithWebhooks)');
      try {
        progressMessage = await thread.post(
          renderStart(userMessage.text, { lng: replyLocale, timezone }),
        );
      } catch (error) {
        log('executeWithWebhooks: failed to post initial placeholder message: %O', error);
      }
    }

    return { gatewayConnectionId, progressMessage };
  };

  let progressMessage: SentMessage | undefined;
  let gatewayConnectionId: string | undefined;
  if (!deferFeedback) ({ gatewayConnectionId, progressMessage } = await showFeedback());

  const { files, warnings: fileWarnings } = await resolveFiles(userMessage, client);
  const prompt = formatPrompt(userMessage, client);
  const botSender = botContext?.platform
    ? buildBotSender(userMessage as any, botContext.platform)
    : undefined;

  // Tell the agent it may stay silent; see `formatBotPlatformContext`.
  if (deferFeedback && botPlatformContext) {
    botPlatformContext.wakeKind = wakeKind;
    if (opts.duty) botPlatformContext.duty = opts.duty;
    if (opts.followup) botPlatformContext.followup = opts.followup;
    if (opts.named) botPlatformContext.named = true;
  }
  if (opts.openingReply && botPlatformContext) botPlatformContext.openingReply = opts.openingReply;
  if (botPlatformContext) {
    if (opts.replyStyle) botPlatformContext.replyStyle = opts.replyStyle;
    if (opts.replyEmojis?.length) botPlatformContext.replyEmojis = opts.replyEmojis;
  }
  if (opts.standDown && botPlatformContext) botPlatformContext.standDown = true;

  // Attach file warnings to botPlatformContext for injection via context engine
  if (fileWarnings?.length && botPlatformContext) {
    botPlatformContext.warnings = fileWarnings;
  }

  // Build webhook config for production mode
  const callbackUrl = '/api/agent/webhooks/bot-callback';
  const webhookBody = {
    applicationId: botContext?.applicationId,
    // Forward the messenger discriminator (set by MessengerRouter for runs
    // originated by the shared Messenger bot). The callback uses this — not
    // the synthetic applicationId shape — to decide which credential source
    // to read from.
    messengerInstallationKey: botContext?.messengerInstallationKey,
    platformThreadId: botContext?.platformThreadId,
    progressMessageId: progressMessage?.id,
    // Pass thread name only if it's user-set.
    // Bot-generated threads use "Thread <locale date>" (e.g. "Thread 4/9/2026, 6:00:00 PM"),
    // which always starts with "Thread " followed by a digit.
    threadName:
      channelContext?.thread?.name && /^Thread \d/.test(channelContext.thread.name)
        ? undefined
        : channelContext?.thread?.name,
    // Forward the lobe userId so messenger callbacks can rebuild the same
    // per-user gateway connectionId (`messenger:<platform>[:<tenant>]:user-<userId>`)
    // that we used to start typing here. Without it, `BotCallbackService`
    // falls back to `connectionId: ''` and `stopGatewayTyping` becomes a
    // no-op — leaving the typing indicator to expire on the gateway's 60s
    // alarm timeout instead of stopping at completion.
    userId: deps.userId,
    userMessageId: userMessage.id,
    // The completion callback runs in another process (queue mode) and needs this to decide
    // whether an empty / `NO_REPLY` finish is silence or a fault, and to defer feedback.
    wakeKind,
    workspaceId: deps.workspaceId,
  };

  log(
    'executeWithCallback: agentId=%s, queueMode=%s, prompt=%s, files=%d',
    agentId,
    queueMode,
    prompt.slice(0, 100),
    files?.length ?? 0,
  );

  // In queue mode, return immediately after startup — hooks handle the rest via webhooks
  if (queueMode) {
    return executeWithHooksQueueMode(deps, thread, userMessage, aiAgentService, {
      agentId,
      botContext,
      botPlatformContext,
      botSender,
      callbackUrl,
      channelContext,
      client,
      files,
      progressMessage,
      prompt,
      replyLocale,
      toolModeOverride,
      topicId,
      trigger,
      webhookBody,
    });
  }

  // In local mode, wrap in a Promise — hook handlers resolve/reject it in-process
  return executeWithHooksLocalMode(deps, thread, aiAgentService, {
    agentId,
    botContext,
    botPlatformContext,
    botSender,
    botSettings: opts.botSettings,
    callbackUrl,
    charLimit,
    channelContext,
    client,
    displayToolCalls,
    files,
    gatewayConnectionId,
    progressMessage,
    prompt,
    reactionMode,
    replyLocale,
    showFeedback: deferFeedback ? showFeedback : undefined,
    toolModeOverride,
    topicId,
    trigger,
    userMessage,
    wakeKind,
    webhookBody,
  });
}
