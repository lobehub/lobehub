import type { ActionEvent, Message, SlashCommandEvent } from 'chat';

import type { PlatformClient } from '@/server/services/bot/platforms';

export interface UnlinkedMessageContext {
  authorUserId: string;
  authorUserName?: string;
  /** When set, the inbound was a non-DM `@mention` (Slack channel today).
   *  The binder should respond ephemerally so the verify-im URL isn't
   *  broadcast to the rest of the channel. The raw chat-sdk `thread.id`
   *  carries the platform's thread anchor — Slack encodes it as the third
   *  colon-segment of `slack:<channel>:<threadTs>` so the ephemeral can be
   *  posted in-thread next to the mention. */
  channelMentionThreadId?: string;
  chatId: string;
  /** Original inbound chat-sdk message. Absent on slash-command paths
   *  (Slack `/start`) where there is no underlying Message instance. */
  message?: Message;
}

export interface AgentPickerEntry {
  id: string;
  isActive: boolean;
  title: string;
}

/** Raw inbound platform update used for actions chat-sdk doesn't surface. */
export interface InboundCallbackAction {
  /** Platform-specific raw id needed to acknowledge the action. */
  callbackId: string;
  /** Conversation id to send replies / edits to. */
  chatId: string;
  /** Application-defined key — e.g. `switch:agt_xxxx`. */
  data: string;
  /** ID of the user who tapped the button. */
  fromUserId: string;
  /** Platform message id of the picker (so the picker can be re-rendered). */
  messageId?: string | number;
}

/** Result the router asks the binder to deliver after handling a callback. */
export interface CallbackAcknowledgement {
  /** Optional toast text shown above the user's keyboard. */
  toast?: string;
  /** When set, edit the picker message in place to reflect the new state. */
  updatedPicker?: { entries: AgentPickerEntry[]; text: string };
}

/**
 * Per-platform glue for the shared messenger bot. Wires env credentials into a
 * `PlatformClient` (so the existing AgentBridgeService can drive it) plus
 * thin platform-specific reply helpers used by the link / switch flows.
 *
 * The router composes plain text and asks the binder to deliver it; HTML
 * escaping, parse modes, button rendering live behind the binder so the
 * router stays platform-agnostic.
 */
export interface MessengerPlatformBinder {
  /**
   * Acknowledge a callback action: dismiss the loading spinner, optionally
   * show a toast, and optionally re-render the picker keyboard.
   */
  acknowledgeCallback?: (
    action: InboundCallbackAction,
    ack: CallbackAcknowledgement,
  ) => Promise<void>;

  /** Construct the underlying platform client. Returns null if config is missing.
   *  Async because the credential lookup (`SystemBotProviderModel`) hits the DB. */
  createClient: () => Promise<PlatformClient | null>;

  /**
   * Map a chat-sdk `onAction` event to an `InboundCallbackAction`. Used by
   * platforms that deliver tap actions through chat-sdk rather than as a
   * peek of the raw webhook body — Discord today (chat-adapter-discord acks
   * the interaction with `DeferredUpdateMessage` before calling the
   * router). Returns null when the event isn't one of our buttons. Slack /
   * Telegram leave this unset because they handle actions at webhook time
   * via `extractCallbackAction` instead.
   */
  extractActionFromEvent?: (
    event: ActionEvent,
    client: PlatformClient,
  ) => InboundCallbackAction | null;

  /**
   * Try to extract a tap-action from a raw webhook request. Returns null when
   * the update is a regular message (in which case the caller hands it off to
   * chat-sdk). Platforms without tap callbacks return null unconditionally.
   *
   * The implementation owns body parsing because platforms disagree on the
   * wire format — Telegram posts JSON, Slack posts `application/x-www-form-
   * urlencoded` with a `payload` field. The router clones the request before
   * calling so consumers downstream can still read the body.
   */
  extractCallbackAction?: (req: Request) => Promise<InboundCallbackAction | null>;

  /** Called when an inbound message arrives from a sender that hasn't bound any account yet. */
  handleUnlinkedMessage: (ctx: UnlinkedMessageContext) => Promise<void>;

  /**
   * Best-effort confirmation back to the IM thread once verify-im writes the
   * link row. `activeAgentName` is included when the verify-im flow set an
   * initial active agent so the user knows where their next message is going.
   * `tenantId` is required for per-tenant platforms (Slack workspace) — the
   * binder uses it to resolve which install's bot token to send with.
   */
  notifyLinkSuccess: (params: {
    activeAgentName?: string;
    platformUserId: string;
    tenantId?: string;
  }) => Promise<void>;

  /**
   * Post an ephemeral message visible only to `userId` in `channelId` —
   * used by the channel-mention link flow so an unlinked mentioner sees
   * the verify-im URL without leaking it to the rest of the channel. When
   * `threadTs` is supplied the ephemeral is anchored in that Slack thread
   * so it appears next to the mention rather than at the bottom of the
   * channel. Platforms without an ephemeral primitive (Telegram) leave
   * this unset and the router falls back to `handleUnlinkedMessage`.
   */
  replyEphemeral?: (params: {
    channelId: string;
    text: string;
    threadTs?: string;
    userId: string;
  }) => Promise<void>;

  /**
   * Send a private response back to the invoker of a chat-sdk interaction
   * (slash command today; modal submit / action follow-up tomorrow). The
   * binder picks the most-private channel the platform offers — Slack uses
   * `chat.postEphemeral` (slash menu can fire from a public channel and we
   * don't want to leak system text); Discord posts via the channel object
   * (DMs are private by definition, public channels stay public until
   * chat-adapter-discord exposes the interaction ephemeral flag).
   *
   * Defining this also opts the platform into native slash command wiring
   * — the router registers every name from its shared command registry so
   * the slash menu stays symmetric across platforms. Telegram leaves this
   * unset because `/cmd` arrives as plain message text and is dispatched
   * by `parseCommand` instead.
   */
  replyPrivately?: (
    channel: SlashCommandEvent['channel'],
    user: SlashCommandEvent['user'],
    text: string,
  ) => Promise<void>;

  /**
   * Send an interactive agent picker so the user can switch the active agent
   * without typing a number. Optional — platforms that don't support
   * tap-to-select keyboards (e.g. plain Slack DMs) can leave this unset and
   * the router will fall back to the text-based `/agents <n>` flow.
   *
   * `ephemeralTo` (when supported) renders the picker as a private message
   * visible only to that user — used when `/agents` is invoked from a
   * public channel so the personal agent list isn't broadcast. Platforms
   * without an ephemeral primitive ignore the field and post normally.
   */
  sendAgentPicker?: (
    chatId: string,
    params: { entries: AgentPickerEntry[]; ephemeralTo?: string; text: string },
  ) => Promise<void>;

  /** Plain DM reply (used by /agents and various command help texts). */
  sendDmText: (chatId: string, text: string) => Promise<void>;
}
