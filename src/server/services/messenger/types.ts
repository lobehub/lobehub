import type { Message } from 'chat';

import type { PlatformClient } from '@/server/services/bot/platforms';

export interface UnlinkedMessageContext {
  authorUserId: string;
  authorUserName?: string;
  chatId: string;
  message: Message;
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
  /** Construct the underlying platform client. Returns null if env config is missing. */
  createClient: () => PlatformClient | null;

  /** Called when an inbound message arrives from a sender that hasn't bound any account yet. */
  handleUnlinkedMessage: (ctx: UnlinkedMessageContext) => Promise<void>;

  /**
   * Best-effort confirmation back to the IM thread once verify-im writes the
   * link row. `activeAgentName` is included when the verify-im flow set an
   * initial active agent so the user knows where their next message is going.
   */
  notifyLinkSuccess: (params: {
    activeAgentName?: string;
    platformUserId: string;
  }) => Promise<void>;

  /** Plain DM reply (used by /agents, /switch, and various command help texts). */
  sendDmText: (chatId: string, text: string) => Promise<void>;
}
