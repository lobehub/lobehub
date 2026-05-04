import type { Message } from 'chat';

import type { PlatformClient } from '@/server/services/bot/platforms';

export interface UnlinkedMessageContext {
  authorUserId: string;
  authorUserName?: string;
  chatId: string;
  message: Message;
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
   * Send an interactive agent picker so the user can switch the active agent
   * without typing a number. Optional — platforms that don't support
   * tap-to-select keyboards (e.g. plain Slack DMs) can leave this unset and
   * the router will fall back to the text-based `/agents <n>` flow.
   */
  sendAgentPicker?: (
    chatId: string,
    params: { entries: AgentPickerEntry[]; text: string },
  ) => Promise<void>;

  /** Plain DM reply (used by /agents and various command help texts). */
  sendDmText: (chatId: string, text: string) => Promise<void>;
}
