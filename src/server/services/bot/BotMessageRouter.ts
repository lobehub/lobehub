import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { DEFAULT_BOT_DEBOUNCE_MS } from '@lobechat/const';
import { Chat, ConsoleLogger, type Message, type MessageContext } from 'chat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { AiAgentService } from '@/server/services/aiAgent';

import { AgentBridgeService } from './AgentBridgeService';
import {
  createOrGetPairingRequest,
  deletePairingRequest,
  peekPairingRequest,
  releasePairingClaim,
} from './dmPairingStore';
import {
  type BotPlatformRuntimeContext,
  type BotReplyLocale,
  buildRuntimeKey,
  type DmDecision,
  type DmSettings,
  extractDmSettings,
  extractGroupSettings,
  extractUserAllowlist,
  getBotReplyLocale,
  type GroupSettings,
  normalizeAllowFromEntries,
  normalizeBotReplyLocale,
  type PlatformClient,
  type PlatformDefinition,
  platformRegistry,
  resolveBotProviderConfig,
  shouldAllowSender,
  shouldHandleDm,
  shouldHandleGroup,
  type UserAllowlist,
} from './platforms';
import {
  renderApproveSuccess,
  renderCommandReply,
  renderDmPairing,
  renderDmRejected,
  renderError,
  renderGroupRejected,
  renderInlineError,
  renderSenderRejected,
} from './replyTemplate';

const log = debug('lobe-server:bot:message-router');

/**
 * Compact summary of a Chat SDK Message's attachments for debug logging.
 * Lets us trace exactly what the platform adapter handed us at the point
 * where the bot router receives it (before merge / extractFiles run).
 */
const summarizeMessageAttachments = (message: Message): Array<Record<string, unknown>> => {
  const attachments = (message as any).attachments as
    | Array<{
        buffer?: Buffer;
        fetchData?: () => Promise<Buffer>;
        mimeType?: string;
        name?: string;
        size?: number;
        type?: string;
        url?: string;
      }>
    | undefined;
  if (!attachments?.length) return [];
  return attachments.map((att) => ({
    hasBuffer: !!att.buffer,
    hasFetchData: typeof att.fetchData === 'function',
    hasUrl: !!att.url,
    mimeType: att.mimeType,
    name: att.name,
    size: att.size,
    type: att.type,
  }));
};

interface ResolvedAgentInfo {
  agentId: string;
  userId: string;
}

interface RegisteredBot {
  agentInfo: ResolvedAgentInfo;
  chatBot: Chat<any>;
  client: PlatformClient;
}

/** Context passed to every command handler — a minimal surface shared by both
 *  native slash-command events and text-based message events. */
interface CommandContext {
  /** Text after the command name (e.g. "/new foo" → "foo"). */
  args: string;
  /** Platform user ID of the invoking user. Optional because the source
   *  event may not carry one (best-effort), but commands that gate on
   *  identity (e.g. `/approve` requires the owner) treat its absence as
   *  failure. */
  authorUserId?: string;
  /** Display name of the invoking user. Optional because some platforms
   *  surface only the ID, not a friendly label. */
  authorUserName?: string;
  post: (text: string) => Promise<any>;
  /** Locale to use for any system-generated reply text. Plumbed in by the
   *  caller — text-based commands derive it per-message via the platform's
   *  `extractAuthorLocale`, native slash commands fall back to the platform
   *  default since their event shape doesn't always carry user locale. */
  replyLocale: BotReplyLocale;
  setState: (state: Record<string, any>, opts?: { replace?: boolean }) => Promise<any>;
  threadId: string;
}

/** A single bot command definition.
 *  Add new entries to `buildCommands()` to register additional commands. */
interface BotCommand {
  description: string;
  handler: (ctx: CommandContext) => Promise<void>;
  name: string;
  /**
   * Native slash-command argument schema for platforms that require
   * arguments to be declared up-front (Discord, Slack). Without this,
   * Discord registers the command as zero-arg — clicking it from the
   * slash menu fires the handler with `ctx.args` empty even when the
   * user expected to pass a value. Adapters flatten option values back
   * into `event.text`, so the handler still reads `ctx.args` as before.
   *
   * Text-based platforms (Telegram / Feishu) ignore this and parse args
   * from the trailing message text via the dispatch regex.
   */
  options?: Array<{
    description: string;
    name: string;
    required?: boolean;
  }>;
}

/**
 * Routes incoming webhook events to the correct Chat SDK Bot instance
 * and triggers message processing via AgentBridgeService.
 *
 * All platforms require appId in the webhook URL:
 *   POST /api/agent/webhooks/[platform]/[appId]
 *
 * Bots are loaded on-demand: only the bot targeted by the incoming webhook
 * is created, not all bots across all platforms.
 */
export class BotMessageRouter {
  /** "platform:applicationId" → registered bot */
  private bots = new Map<string, RegisteredBot>();

  /** Per-key init promises to avoid duplicate concurrent loading */
  private loadingPromises = new Map<string, Promise<RegisteredBot | null>>();

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Get the webhook handler for a given platform + appId.
   * Returns a function compatible with Next.js Route Handler: `(req: Request) => Promise<Response>`
   */
  getWebhookHandler(platform: string, appId?: string): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      const entry = platformRegistry.getPlatform(platform);
      if (!entry) {
        return new Response('No bot configured for this platform', { status: 404 });
      }

      if (!appId) {
        return new Response(`Missing appId for ${platform} webhook`, { status: 400 });
      }

      return this.handleWebhook(req, platform, appId);
    };
  }

  /**
   * Invalidate a cached bot so it gets reloaded with fresh config on next webhook.
   * Call this after settings or credentials are updated.
   */
  async invalidateBot(platform: string, appId: string): Promise<void> {
    const key = buildRuntimeKey(platform, appId);
    const existing = this.bots.get(key);
    if (!existing) return;

    log('invalidateBot: removing cached bot %s', key);
    this.bots.delete(key);
  }

  // ------------------------------------------------------------------
  // Webhook handling
  // ------------------------------------------------------------------

  private async handleWebhook(req: Request, platform: string, appId: string): Promise<Response> {
    log('handleWebhook: platform=%s, appId=%s', platform, appId);

    const bot = await this.getOrCreateBot(platform, appId);
    if (!bot) {
      return new Response(`No bot configured for ${platform}`, { status: 404 });
    }

    if (bot.chatBot.webhooks && platform in bot.chatBot.webhooks) {
      return (bot.chatBot.webhooks as any)[platform](req);
    }

    return new Response(`No bot configured for ${platform}`, { status: 404 });
  }

  // ------------------------------------------------------------------
  // On-demand bot loading
  // ------------------------------------------------------------------

  /**
   * Get an existing bot or create one on-demand from DB.
   * Concurrent calls for the same key are deduplicated.
   */
  private async getOrCreateBot(platform: string, appId: string): Promise<RegisteredBot | null> {
    const key = buildRuntimeKey(platform, appId);

    // Return cached bot
    const existing = this.bots.get(key);
    if (existing) return existing;

    // Deduplicate concurrent loads for the same key
    const inflight = this.loadingPromises.get(key);
    if (inflight) return inflight;

    const promise = this.loadBot(platform, appId);
    this.loadingPromises.set(key, promise);

    try {
      return await promise;
    } finally {
      this.loadingPromises.delete(key);
    }
  }

  private async loadBot(platform: string, appId: string): Promise<RegisteredBot | null> {
    const key = buildRuntimeKey(platform, appId);

    try {
      const entry = platformRegistry.getPlatform(platform);
      if (!entry) {
        log('No definition for platform: %s', platform);
        return null;
      }

      const serverDB = await getServerDB();
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

      // Find the specific provider — search across all users
      const providers = await AgentBotProviderModel.findEnabledByPlatform(
        serverDB,
        platform,
        gateKeeper,
      );
      const provider = providers.find((p) => p.applicationId === appId);

      if (!provider) {
        log('No enabled provider found for %s', key);
        return null;
      }

      const registered = await this.createAndRegisterBot(entry, provider, serverDB);
      log('Created %s bot on-demand for agent=%s, appId=%s', platform, provider.agentId, appId);
      return registered;
    } catch (error) {
      log('Failed to load bot %s: %O', key, error);
      return null;
    }
  }

  private async createAndRegisterBot(
    entry: PlatformDefinition,
    provider: DecryptedBotProvider,
    serverDB: LobeChatDatabase,
  ): Promise<RegisteredBot> {
    const { agentId, userId, applicationId } = provider;
    const platform = entry.id;
    const key = buildRuntimeKey(platform, applicationId);

    const { config: providerConfig, settings } = resolveBotProviderConfig(entry, provider);

    log(
      'createAndRegisterBot: %s settings merge: userSettings=%j, merged=%j',
      key,
      provider.settings,
      settings,
    );

    const runtimeContext: BotPlatformRuntimeContext = {
      appUrl: appEnv.APP_URL,
      redisClient: getAgentRuntimeRedisClient() as any,
    };

    const client = entry.clientFactory.createClient(providerConfig, runtimeContext);
    const adapters = client.createAdapter();

    // dmSettings + operatorUserId are needed by `/approve` (to enforce the
    // owner-only gate and to know whether pairing is even enabled), and by
    // the DM pairing branch in registerHandlers. Extract once, share with
    // both — registerHandlers re-derives from `settings` to keep its own
    // closure-internal contract self-contained.
    const dmSettings: DmSettings = extractDmSettings(settings);
    const operatorUserId =
      typeof settings.userId === 'string'
        ? (settings.userId as string).trim() || undefined
        : undefined;

    const commands = this.buildCommands(serverDB, {
      agentId,
      applicationId,
      client,
      dmSettings,
      operatorUserId,
      platform,
      providerId: provider.id,
      userId,
    });

    // Default to 'queue' for legacy providers that don't have `concurrency`
    // in their saved settings. Historically this defaulted to 'debounce', but
    // chat-sdk's debounce semantics are "drop all but the latest" (Lodash-style),
    // which silently evicts media messages when followed by a quick text query.
    // 'queue' preserves all pending messages and merges them via
    // `mergeSkippedMessages`, which is the right default for chat UX.
    const concurrencyStrategy = (settings.concurrency as string) || 'queue';
    const debounceMs = (settings.debounceMs as number) || DEFAULT_BOT_DEBOUNCE_MS;
    const chatBot = this.createChatBot(
      adapters,
      `agent-${agentId}`,
      concurrencyStrategy,
      debounceMs,
    );
    this.registerHandlers(chatBot, serverDB, client, commands, {
      agentId,
      applicationId,
      platform,
      settings,
      userId,
    });
    await chatBot.initialize();
    client.applyChatPatches?.(chatBot);

    // Register platform-specific bot commands (e.g., Telegram setMyCommands menu)
    if (client.registerBotCommands) {
      const commandList = commands.map((c) => ({
        command: c.name,
        description: c.description,
        options: c.options,
      }));
      client.registerBotCommands(commandList).catch((error) => {
        log('registerBotCommands failed for %s: %O', key, error);
      });
    }

    const registered: RegisteredBot = {
      agentInfo: { agentId, userId },
      chatBot,
      client,
    };

    this.bots.set(key, registered);

    return registered;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * A proxy around the shared Redis client that suppresses duplicate `on('error', ...)`
   * registrations. Each `createIoRedisState()` call adds an error listener to the client;
   * with many bot instances sharing one client this would trigger
   * MaxListenersExceededWarning. The proxy lets the first error listener through and
   * silently drops subsequent ones, so it scales to any number of bots.
   */
  private sharedRedisProxy: ReturnType<typeof getAgentRuntimeRedisClient> | undefined;

  private getSharedRedisProxy() {
    if (this.sharedRedisProxy !== undefined) return this.sharedRedisProxy;

    const redisClient = getAgentRuntimeRedisClient();
    if (!redisClient) {
      this.sharedRedisProxy = null;
      return null;
    }

    let errorListenerRegistered = false;
    this.sharedRedisProxy = new Proxy(redisClient, {
      get(target, prop, receiver) {
        if (prop === 'on') {
          return (event: string, listener: (...args: any[]) => void) => {
            if (event === 'error') {
              if (errorListenerRegistered) return target;
              errorListenerRegistered = true;
            }
            return target.on(event, listener);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    return this.sharedRedisProxy;
  }

  private createChatBot(
    adapters: Record<string, any>,
    label: string,
    concurrencyStrategy: string,
    debounceMs: number,
  ): Chat<any> {
    const config: any = {
      adapters,
      concurrency:
        concurrencyStrategy === 'debounce' ? { debounceMs, strategy: 'debounce' } : 'queue',
      userName: `lobehub-bot-${label}`,
    };

    const redisClient = getAgentRuntimeRedisClient();
    if (redisClient) {
      config.state = createIoRedisState({
        client: redisClient,
        keyPrefix: `chat-sdk:${label}`,
        logger: new ConsoleLogger(),
      });
    }

    return new Chat(config);
  }

  /**
   * Merge messages skipped by the Chat SDK concurrency strategy (debounce/queue)
   * with the current message. Returns a single message with combined text and
   * attachments so the agent sees the full user intent.
   */
  private static mergeSkippedMessages(
    message: Message,
    context?: { skipped?: Message[] },
  ): Message {
    if (!context?.skipped?.length) return message;

    // context.skipped is chronological; current message is the latest
    const allMessages = [...context.skipped, message];
    const mergedText = allMessages
      .map((m) => m.text)
      .filter(Boolean)
      .join('\n');
    const mergedAttachments = allMessages.flatMap((m) => (m as any).attachments || []);

    return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
      attachments: mergedAttachments,
      text: mergedText,
    });
  }

  private registerHandlers(
    bot: Chat<any>,
    serverDB: LobeChatDatabase,
    client: PlatformClient,
    commands: BotCommand[],
    info: ResolvedAgentInfo & {
      applicationId: string;
      platform: string;
      settings?: Record<string, any>;
    },
  ): void {
    const { agentId, applicationId, platform, userId } = info;
    const bridge = new AgentBridgeService(serverDB, userId);
    const charLimit = (info.settings?.charLimit as number) || undefined;
    const displayToolCalls = info.settings?.displayToolCalls === true;
    const dmSettings: DmSettings = extractDmSettings(info.settings);
    const groupSettings: GroupSettings = extractGroupSettings(info.settings);
    const userAllowlist: UserAllowlist = extractUserAllowlist(info.settings);
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

    /**
     * Global user-level gate. Applied **before** any per-scope policy so a
     * populated `allowFrom` restricts every inbound surface (DMs, group
     * @mentions, threads) to listed users. Empty list = no filter.
     */
    const passesGlobalAllowlist = (message: { author?: { userId?: string } }): boolean =>
      shouldAllowSender({
        authorUserId: message.author?.userId,
        userAllowlist,
      });

    /**
     * Gate inbound events on DM policy. Non-DM threads pass through — their
     * group-policy / @mention rules apply instead. The `'pair'` decision
     * is distinct from `'reject'` because the router branches on it (issue
     * a pairing code) — see `passGatesOrNotify` below.
     */
    const passesDmPolicy = (
      thread: { isDM?: boolean },
      message: { author?: { userId?: string } },
    ): DmDecision =>
      shouldHandleDm({
        authorUserId: message.author?.userId,
        dmSettings,
        isDM: thread.isDM === true,
        operatorUserId,
        userAllowlist,
      });

    /**
     * Gate inbound events on group policy. DM threads pass through — they
     * are governed by `passesDmPolicy` instead. Non-DM threads are blocked
     * when disabled, and filtered against `groupAllowFrom` (channel / group
     * / chat IDs) when set to `allowlist`.
     *
     * Operators paste **raw** platform IDs (what Discord's "Copy Channel
     * ID" or Telegram's chat-id tools yield), but `thread.channelId` is a
     * *composite* string carrying the platform prefix
     * (`discord:guild:channel`, `telegram:chatId`, …). Using it directly
     * never matches a raw paste. Each PlatformClient already exposes
     * `extractChatId` returning the most-specific raw ID, so we use that
     * as the primary candidate.
     *
     * Discord-only quirk: a bare `@mention` in a parent channel triggers
     * an auto-reply thread; `extractChatId` then resolves to the thread,
     * not the parent operators pasted. `extraGroupAllowlistChannels`
     * surfaces the parent so either ID lets the message through.
     */
    const passesGroupPolicy = (thread: { id: string; isDM?: boolean }): boolean =>
      shouldHandleGroup({
        candidateChannelIds: [
          client.extractChatId(thread.id),
          ...(client.extraGroupAllowlistChannels?.(thread.id) ?? []),
        ],
        groupSettings,
        isDM: thread.isDM === true,
      });

    /**
     * Handle a sender that the global `allowFrom` rejected. Posts the
     * notice in the same thread the inbound event arrived on, mirroring
     * `notifyGroupRejected` / `notifyDmRejected` rather than escalating
     * to ephemeral / out-of-band DM.
     *
     * - DM scope: uses the DM-allowlist copy ("you aren't authorized to
     *   send direct messages…") since the sender is on the DM surface.
     * - Group scope: uses the generic `senderRejected` copy that avoids
     *   "direct messages" — the sender @-mentioned in a group, not in a
     *   DM. On Discord this lands inside the auto-created reply thread,
     *   so it doesn't pollute the parent channel; on Telegram / Slack /
     *   Feishu it's visible to the group, which is consistent with how
     *   `notifyGroupRejected` already handles policy-driven rejections.
     */
    const handleSenderRejected = async (
      thread: { isDM?: boolean; post: (text: string) => Promise<unknown> },
      replyLocale: BotReplyLocale,
    ): Promise<void> => {
      const text =
        thread.isDM === true
          ? renderDmRejected('allowlist', replyLocale)
          : renderSenderRejected(replyLocale);
      try {
        await thread.post(text);
      } catch (error) {
        log('handleSenderRejected: failed to post rejection notice: %O', error);
      }
    };

    /**
     * Post a one-line system reply telling the sender why their DM was
     * dropped. Best-effort — a transient platform error must never bubble
     * back into the handler since the message is informational, not part of
     * the agent flow.
     */
    const notifyDmRejected = async (
      thread: { post: (text: string) => Promise<unknown> },
      replyLocale: BotReplyLocale,
    ): Promise<void> => {
      // 'open' and 'pairing' should never reach here ('pairing' has its own
      // flow via triggerDmPairing), but guard anyway so we never post the
      // wrong copy if shouldHandleDm grows another false branch.
      if (dmSettings.policy !== 'allowlist' && dmSettings.policy !== 'disabled') return;
      try {
        await thread.post(renderDmRejected(dmSettings.policy, replyLocale));
      } catch (error) {
        log('notifyDmRejected: failed to post rejection notice: %O', error);
      }
    };

    /**
     * Same shape as `notifyDmRejected`, for group / channel rejection. The
     * @mention is public, so the rejection is too — operators get UX
     * feedback that their bot is configured to a smaller scope.
     */
    const notifyGroupRejected = async (
      thread: { post: (text: string) => Promise<unknown> },
      replyLocale: BotReplyLocale,
    ): Promise<void> => {
      if (groupSettings.policy === 'open') return;
      try {
        await thread.post(renderGroupRejected(groupSettings.policy, replyLocale));
      } catch (error) {
        log('notifyGroupRejected: failed to post rejection notice: %O', error);
      }
    };

    /**
     * Pairing branch of the DM gate: stranger DMed a bot in `pairing` mode.
     * Issue (or recycle, when the same applicant DMed within the TTL) a
     * one-time code, persist a pending entry to Redis so `/approve <code>`
     * can later append the applicant to `allowFrom`, and post the code in
     * the applicant's DM thread.
     *
     * Best-effort: if Redis is unwired (`'redis-unavailable'`) or the
     * per-bot pending cap is hit (`'capacity-exceeded'`), surface a useful
     * status string to the applicant rather than silently dropping them —
     * silent drops look broken and operators waste time debugging.
     */
    const triggerDmPairing = async (
      thread: { id: string; post: (text: string) => Promise<unknown> },
      author: { userId?: string; userName?: string },
      replyLocale: BotReplyLocale,
    ): Promise<void> => {
      if (!author.userId) {
        log(
          'triggerDmPairing: missing author userId, cannot pair (agent=%s, platform=%s)',
          agentId,
          platform,
        );
        return;
      }
      const result = await createOrGetPairingRequest({
        applicant: {
          applicantUserId: author.userId,
          applicantUserName: author.userName,
          replyLocale,
          threadId: thread.id,
        },
        applicationId,
        platform,
        redis: getAgentRuntimeRedisClient(),
      });
      let text: string;
      if (result.status === 'created' || result.status === 'reused') {
        text = renderDmPairing('code', replyLocale, { code: result.code });
      } else if (result.status === 'capacity-exceeded') {
        text = renderDmPairing('capacity-exceeded', replyLocale);
      } else {
        text = renderDmPairing('unavailable', replyLocale);
      }
      try {
        await thread.post(text);
      } catch (error) {
        log('triggerDmPairing: failed to post pairing notice: %O', error);
      }
    };

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
      },
      text: string | undefined,
      author: { userId?: string; userName?: string } | undefined,
      replyLocale: BotReplyLocale,
    ): Promise<boolean> => {
      const sanitized = client.sanitizeUserInput?.(text ?? '') ?? text;
      const result = BotMessageRouter.dispatchTextCommand(sanitized, commands);
      if (!result) return false;
      await result.command.handler({
        args: result.args,
        authorUserId: author?.userId,
        authorUserName: author?.userName,
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
      return BotMessageRouter.dispatchTextCommand(sanitized, commands) !== null;
    };

    /**
     * Run all three access gates (global `allowFrom`, group policy, DM policy)
     * and post the appropriate rejection notice in the thread on failure.
     * Returns true when the inbound passes every gate.
     *
     * Centralised so every entry point — @-mentions, subscribed-message
     * handler, DM catch-all, **and the slash-command dispatchers** — applies
     * the same checks. Without this, a /command path could side-effect
     * (`/stop` cancelling a run, `/new` resetting state) for senders the
     * normal message path would have rejected.
     */
    const passGatesOrNotify = async (
      thread: { id: string; isDM?: boolean; post: (t: string) => Promise<unknown> },
      author: { userId?: string; userName?: string },
      replyLocale: BotReplyLocale,
      caller: string,
    ): Promise<boolean> => {
      // Owner override. The bot's operator (`settings.userId`) sets the
      // policies for *other* users — locking themselves out of their own
      // bot is a footgun. Without this branch:
      // - `/approve` in any group channel that isn't in `groupAllowFrom`
      //   gets rejected by the group gate, breaking the approval flow
      //   from a not-yet-allowed channel (Discord native slash commands
      //   in particular sometimes report `event.channel.isDM=false` for
      //   DM invocations, putting the gate on the group branch).
      // - DMing a `disabled` bot for a self-test gets blocked.
      // The override is unconditional on author identity, so non-command
      // messages from the operator also pass — that matches the existing
      // implicit-merge of `settings.userId` into `extractUserAllowlist`,
      // which already treats the operator as always-allowed.
      if (operatorUserId && author.userId === operatorUserId) {
        return true;
      }
      // Pairing redefines what `allowFrom` means: it's the *post-approval*
      // list (managed by `/approve`), not a hard identity gate. A stranger
      // DMing a pairing bot must reach the DM gate's `'pair'` branch so we
      // can issue them a code — but the global allowFrom gate would
      // otherwise short-circuit them out at step 1 (since they're not yet
      // approved). Skip the global gate for DM threads under pairing so
      // the DM gate alone governs user filtering. Other policies are
      // unaffected: `open` keeps allowFrom as an extra lockdown layer,
      // `allowlist` resolves to the same list either way, `disabled`
      // rejects regardless.
      const isPairingDm = thread.isDM === true && dmSettings.policy === 'pairing';
      if (!isPairingDm && !passesGlobalAllowlist({ author })) {
        log(
          '%s: sender blocked by allowFrom, agent=%s, platform=%s, thread=%s, author=%s',
          caller,
          agentId,
          platform,
          thread.id,
          author.userName ?? author.userId,
        );
        await handleSenderRejected(thread, replyLocale);
        return false;
      }
      if (!passesGroupPolicy(thread)) {
        log(
          '%s: group blocked by policy, agent=%s, platform=%s, thread=%s, policy=%s',
          caller,
          agentId,
          platform,
          thread.id,
          groupSettings.policy,
        );
        await notifyGroupRejected(thread, replyLocale);
        return false;
      }
      const dmDecision = passesDmPolicy(thread, { author });
      if (dmDecision === 'allow') return true;
      log(
        '%s: DM gate=%s, agent=%s, platform=%s, thread=%s, author=%s, policy=%s',
        caller,
        dmDecision,
        agentId,
        platform,
        thread.id,
        author.userName ?? author.userId,
        dmSettings.policy,
      );
      if (dmDecision === 'pair') {
        await triggerDmPairing(thread, author, replyLocale);
      } else {
        await notifyDmRejected(thread, replyLocale);
      }
      return false;
    };

    bot.onNewMention(async (thread, message, context?: MessageContext) => {
      const replyLocale = detectReplyLocale(message);

      // Gate first — must run before tryDispatch so a /command from a
      // non-allowlisted sender can't slip through and side-effect.
      if (!(await passGatesOrNotify(thread, message.author, replyLocale, 'onNewMention'))) {
        return;
      }

      if (await tryDispatch(thread, message.text, message.author, replyLocale)) return;

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

      const merged = BotMessageRouter.mergeSkippedMessages(message, context);
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
      const senderExternalUserId = merged.author?.userId ?? '';
      const isOwner = !!operatorUserId && senderExternalUserId === operatorUserId;
      try {
        await bridge.handleMention(thread, merged, {
          agentId,
          botContext: {
            applicationId,
            isOwner,
            platform,
            platformThreadId: thread.id,
            senderExternalUserId,
          },
          charLimit,
          client,
          displayToolCalls,
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
          await thread.post({ markdown: renderError(operationId, replyLocale) });
        } catch {
          // best-effort notification
        }
      }
    });

    bot.onSubscribedMessage(async (thread, message, context?: MessageContext) => {
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
      const isAddressedToBot =
        thread.isDM ||
        message.isMention === true ||
        context?.skipped?.some((m) => m.isMention === true) === true;
      const isCommand = looksLikeCommand(message.text);

      if (!isAddressedToBot && !isCommand) {
        log(
          'onSubscribedMessage: skip non-mention in group thread, agent=%s, platform=%s, author=%s, thread=%s',
          agentId,
          platform,
          message.author.userName,
          thread.id,
        );
        return;
      }

      // Gate before tryDispatch so a /command from a non-allowlisted sender
      // (or in a disabled DM/group scope) cannot side-effect.
      if (!(await passGatesOrNotify(thread, message.author, replyLocale, 'onSubscribedMessage'))) {
        return;
      }

      if (await tryDispatch(thread, message.text, message.author, replyLocale)) return;

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

      const merged = BotMessageRouter.mergeSkippedMessages(message, context);
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

      const senderExternalUserId = merged.author?.userId ?? '';
      const isOwner = !!operatorUserId && senderExternalUserId === operatorUserId;
      try {
        await bridge.handleSubscribedMessage(thread, merged, {
          agentId,
          botContext: {
            applicationId,
            isOwner,
            platform,
            platformThreadId: thread.id,
            senderExternalUserId,
          },
          charLimit,
          client,
          displayToolCalls,
          replyLocale,
        });
      } catch (error) {
        const operationId = AgentBridgeService.getActiveOperationId(thread.id);
        log(
          'onSubscribedMessage: unhandled error from handleSubscribedMessage: operationId=%s, %O',
          operationId,
          error,
        );
        try {
          await thread.post({ markdown: renderError(operationId, replyLocale) });
        } catch {
          // best-effort notification
        }
      }
    });

    // Register slash command handlers (native + text-based). The gate
    // helper is passed in so command paths share the access checks with
    // the message handlers — without this, a non-allowlisted sender could
    // /stop or /new and bypass the rest of the policy stack.
    this.registerCommands(
      bot,
      commands,
      client,
      {
        detectFromMessage: detectReplyLocale,
        fallback: fallbackReplyLocale,
      },
      passGatesOrNotify,
    );

    // DM catch-all: only registered when DM handling is enabled. For mixed
    // platforms (e.g. Slack/Discord with both DMs and group channels), the
    // handler itself restricts routing to DM threads that satisfy the policy —
    // otherwise the `/./` regex would match every group message and hijack
    // non-mention traffic. Group @-mentions keep going through `onNewMention`.
    if (dmSettings.policy !== 'disabled') {
      bot.onNewMessage(/./, async (thread, message, context?: MessageContext) => {
        if (message.author.isBot === true) return;

        // Skip text-based slash commands — already handled by registerCommands
        // (which applies the same gates).
        if (BotMessageRouter.dispatchTextCommand(message.text, commands)) return;

        // The catch-all exists solely to handle DMs on mention-less platforms
        // (Telegram, WeChat, …) and on mixed platforms where the DM flow should
        // not require an @-mention. Group / channel traffic is already handled
        // by onNewMention + onSubscribedMessage; if we let it through here we
        // would hijack every non-mention message in shared threads.
        if (thread.isDM !== true) return;

        const replyLocale = detectReplyLocale(message);

        if (
          !(await passGatesOrNotify(
            thread,
            message.author,
            replyLocale,
            `onNewMessage (${platform} catch-all)`,
          ))
        ) {
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

        const merged = BotMessageRouter.mergeSkippedMessages(message, context);
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

        const senderExternalUserId = merged.author?.userId ?? '';
        const isOwner = !!operatorUserId && senderExternalUserId === operatorUserId;
        try {
          await bridge.handleMention(thread, merged, {
            agentId,
            botContext: {
              applicationId,
              isOwner,
              platform,
              platformThreadId: thread.id,
              senderExternalUserId,
            },
            charLimit,
            client,
            displayToolCalls,
            replyLocale,
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
  }

  // ------------------------------------------------------------------
  // Command registry
  // ------------------------------------------------------------------

  /**
   * Build the list of bot commands. Each entry defines a name, description,
   * and handler. To add a new command, just append to this array.
   *
   * Handlers close over `info` so they can reach services and the bot's
   * own configuration (DM policy, owner identity, applicationId) without
   * needing every command entry threaded through CommandContext.
   */
  private buildCommands(
    serverDB: LobeChatDatabase,
    info: {
      agentId: string;
      applicationId: string;
      /** PlatformClient used to message the applicant after a successful
       *  `/approve`; the owner runs the command in their own thread, but
       *  the applicant's notification has to land in the applicant's DM. */
      client: PlatformClient;
      dmSettings: DmSettings;
      operatorUserId?: string;
      platform: string;
      /** DB row id of the agent_bot_providers row for this bot — used by
       *  `/approve` to append a fresh applicant to `settings.allowFrom`. */
      providerId: string;
      userId: string;
    },
  ): BotCommand[] {
    const {
      agentId,
      applicationId,
      client,
      dmSettings,
      operatorUserId,
      platform,
      providerId,
      userId,
    } = info;

    return [
      {
        description: 'Start a new conversation',
        handler: async (ctx) => {
          log('command /new: agent=%s, platform=%s', agentId, platform);
          await ctx.setState({ topicId: undefined }, { replace: true });
          await ctx.post(renderCommandReply('cmdNewReset', ctx.replyLocale));
        },
        name: 'new',
      },
      {
        description: 'Stop the current execution',
        handler: async (ctx) => {
          log('command /stop: agent=%s, platform=%s', agentId, platform);
          const isActive = AgentBridgeService.isThreadActive(ctx.threadId);
          if (!isActive) {
            await ctx.post(renderCommandReply('cmdStopNotActive', ctx.replyLocale));
            return;
          }
          const operationId = AgentBridgeService.getActiveOperationId(ctx.threadId);
          if (operationId) {
            try {
              const aiAgentService = new AiAgentService(serverDB, userId);
              const result = await aiAgentService.interruptTask({ operationId });
              if (!result.success) {
                log('command /stop: runtime interrupt rejected for operationId=%s', operationId);
                await ctx.post(renderCommandReply('cmdStopUnable', ctx.replyLocale));
                return;
              }
              AgentBridgeService.clearActiveThread(ctx.threadId);
              log('command /stop: interrupted operationId=%s', operationId);
            } catch (error) {
              log('command /stop: interruptTask failed: %O', error);
              await ctx.post(renderCommandReply('cmdStopUnable', ctx.replyLocale));
              return;
            }
          } else {
            AgentBridgeService.requestStop(ctx.threadId);
            log('command /stop: queued deferred stop for thread=%s', ctx.threadId);
          }
          await ctx.post(renderCommandReply('cmdStopRequested', ctx.replyLocale));
        },
        name: 'stop',
      },
      {
        description: 'Approve a pairing request: /approve <code>',
        options: [
          {
            description: 'The 8-character pairing code shown to the applicant',
            name: 'code',
            required: true,
          },
        ],
        handler: async (ctx) => {
          log(
            'command /approve: agent=%s, platform=%s, author=%s',
            agentId,
            platform,
            ctx.authorUserName ?? ctx.authorUserId,
          );

          if (dmSettings.policy !== 'pairing') {
            await ctx.post(renderCommandReply('cmdApproveDisabled', ctx.replyLocale));
            return;
          }

          // Owner check: the gate in passGatesOrNotify already lets the
          // operator through (operator bypass for pairing), but a
          // pre-approved third party would also pass that gate. The
          // command itself enforces owner-only at the action layer.
          if (!operatorUserId || !ctx.authorUserId || ctx.authorUserId !== operatorUserId) {
            await ctx.post(renderCommandReply('cmdApproveNotOwner', ctx.replyLocale));
            return;
          }

          const code = ctx.args.toUpperCase().trim();
          if (!code) {
            await ctx.post(renderCommandReply('cmdApproveUsage', ctx.replyLocale));
            return;
          }

          const redis = getAgentRuntimeRedisClient();
          const entry = await peekPairingRequest({
            applicationId,
            code,
            platform,
            redis,
          });
          if (!entry) {
            await ctx.post(renderCommandReply('cmdApproveUnknownCode', ctx.replyLocale));
            return;
          }

          // Persist the applicant to allowFrom BEFORE deleting the Redis
          // entry. If persistence fails (transient DB error, missing
          // provider row), the code stays valid so the owner can retry
          // — otherwise the applicant is locked out and we'd need a
          // fresh code from them. Read-modify-write so we preserve every
          // other settings field; `model.update` would otherwise
          // lodash-merge over only the fields we pass.
          const approvedLabel = entry.applicantUserName ?? entry.applicantUserId;
          let persisted = false;
          try {
            const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
            const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
            const provider = await model.findById(providerId);
            if (provider) {
              const settings = (provider.settings ?? {}) as Record<string, unknown>;
              const entries = normalizeAllowFromEntries(settings.allowFrom);
              if (!entries.some((e) => e.id === entry.applicantUserId)) {
                entries.push(
                  entry.applicantUserName
                    ? { id: entry.applicantUserId, name: entry.applicantUserName }
                    : { id: entry.applicantUserId },
                );
                await model.update(providerId, {
                  settings: { ...settings, allowFrom: entries },
                });
                // The router caches RegisteredBot by key; drop it so the
                // next inbound DM rebuilds with fresh allowFrom rather
                // than re-pairing the user we just approved.
                await this.invalidateBot(platform, applicationId);
              }
              // Already on the list counts as a successful approval —
              // the durable state matches what the owner asked for.
              persisted = true;
            } else {
              log(
                'command /approve: provider %s not found while approving code=%s',
                providerId,
                code,
              );
            }
          } catch (error) {
            log('command /approve: failed to persist allowFrom for code=%s: %O', code, error);
          }

          if (!persisted) {
            // Leave the Redis entry intact: the owner can retry the same
            // /approve once the underlying issue clears, without forcing
            // the applicant to mint a new code. Release the peek claim
            // so the retry isn't blocked behind our own lock.
            await releasePairingClaim({ applicationId, code, platform, redis });
            await ctx.post(renderCommandReply('cmdApproveFailed', ctx.replyLocale));
            return;
          }

          await deletePairingRequest({
            applicationId,
            applicantUserId: entry.applicantUserId,
            code,
            platform,
            redis,
          });

          // Notify the applicant in their own DM thread, in the locale
          // they originally DMed in (owner's locale may differ).
          try {
            const messenger = client.getMessenger(entry.threadId);
            await messenger.createMessage(
              renderCommandReply('dmPairingApplicantApproved', entry.replyLocale),
            );
          } catch (error) {
            log('command /approve: failed to notify applicant for code=%s: %O', code, error);
          }

          await ctx.post(renderApproveSuccess(approvedLabel, ctx.replyLocale));
        },
        name: 'approve',
      },
    ];
  }

  /**
   * Parse a text message for a registered command.
   * Handles formats: "/cmd", "/cmd args", "/cmd@botname args" (Telegram).
   * Returns the matched command and any trailing arguments, or null.
   */
  private static dispatchTextCommand(
    text: string | undefined,
    commands: BotCommand[],
  ): { args: string; command: BotCommand } | null {
    if (!text) return null;
    const match = text.trim().match(/^\/(\w+)(?:@\w+)?(?:\s(.*))?$/s);
    if (!match) return null;
    const name = match[1].toLowerCase();
    const command = commands.find((c) => c.name === name);
    if (!command) return null;
    return { args: match[2]?.trim() ?? '', command };
  }

  /**
   * Register all commands on the bot via both native slash-command events
   * (Slack, Discord) and text-based onNewMessage handlers (Telegram, Feishu, etc.).
   *
   * To add a new command, add an entry to `buildCommands()` — it will be
   * automatically registered on all platforms.
   */
  private registerCommands(
    bot: Chat<any>,
    commands: BotCommand[],
    client: PlatformClient,
    locale: {
      detectFromMessage: (message: { author?: unknown }) => BotReplyLocale;
      fallback: BotReplyLocale;
    },
    /**
     * Apply the same access stack the message handlers use (allowFrom +
     * group policy + DM policy) before dispatching a command. Returns true
     * when the dispatch is allowed; on rejection the helper has already
     * posted the appropriate notice in the thread.
     */
    gate: (
      thread: { id: string; isDM?: boolean; post: (t: string) => Promise<unknown> },
      author: { userId?: string; userName?: string },
      replyLocale: BotReplyLocale,
      caller: string,
    ) => Promise<boolean>,
  ): void {
    // --- Native slash commands (Slack, Discord) ---
    for (const cmd of commands) {
      bot.onSlashCommand(`/${cmd.name}`, async (event) => {
        // Native slash-command events expose a Channel (Postable, so it has
        // `id` / `isDM` / `post`) and the invoking user. Project both into
        // the gate-friendly thread/author shape.
        const threadLike = {
          id: event.channel.id,
          isDM: event.channel.isDM,
          post: (t: string) => event.channel.post(t),
        };
        const authorLike = {
          userId: event.user?.userId,
          userName: event.user?.userName,
        };
        const replyLocale = locale.fallback;
        if (!(await gate(threadLike, authorLike, replyLocale, `onSlashCommand /${cmd.name}`))) {
          return;
        }
        await cmd.handler({
          args: event.text,
          authorUserId: authorLike.userId,
          authorUserName: authorLike.userName,
          post: (text) => event.channel.post(text),
          // Native slash-command events don't carry a Chat SDK Message, so
          // there's no per-sender locale field to read; use the channel
          // default. Telegram/Feishu/etc. dispatch via the text-based path
          // below, which DOES have per-message locale.
          replyLocale,
          setState: (state, opts) => event.channel.setState(state, opts),
          threadId: event.channel.id,
        });
      });
    }

    // --- Text-based slash commands (Telegram, Feishu, etc.) ---
    // Platforms that don't support native onSlashCommand send /commands as
    // regular text messages. This handler intercepts them in unsubscribed
    // threads (e.g. first command in a group chat or DM).
    // The regex also matches mention-prefixed messages (e.g. "<@U123> /new")
    // so that platforms like Slack can dispatch commands from @-mentions.
    const namePattern = commands.map((c) => c.name).join('|');
    const regex = new RegExp(`(?:^|\\s)\\/(?:${namePattern})(?:\\s|$|@)`);
    bot.onNewMessage(regex, async (thread, message) => {
      if (message.author.isBot === true) return;
      const sanitized = client.sanitizeUserInput?.(message.text ?? '') ?? message.text;
      const result = BotMessageRouter.dispatchTextCommand(sanitized, commands);
      if (!result) return;
      const replyLocale = locale.detectFromMessage(message);
      if (
        !(await gate(thread, message.author, replyLocale, `onNewMessage /${result.command.name}`))
      ) {
        return;
      }
      await result.command.handler({
        args: result.args,
        authorUserId: message.author?.userId,
        authorUserName: message.author?.userName,
        post: (text) => thread.post(text),
        replyLocale,
        setState: (state, opts) => thread.setState(state, opts),
        threadId: thread.id,
      });
    });
  }
}

// ------------------------------------------------------------------
// Singleton
// ------------------------------------------------------------------

let instance: BotMessageRouter | null = null;

export function getBotMessageRouter(): BotMessageRouter {
  if (!instance) {
    instance = new BotMessageRouter();
  }
  return instance;
}
