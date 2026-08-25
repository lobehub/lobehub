import type { ShareVisibility } from '../topic';

/** Agent metadata exposed to signed-in visitors of an agent share. */
export interface SharedAgentData {
  /**
   * Agent gateway base URL for visitor execution. The share micro-app never
   * loads the global server config (`ShareAppShell` boots with an empty
   * ServerConfigStore), so the gateway transport cannot read
   * `serverConfig.agentGatewayUrl` there — the share response carries it
   * instead and the visitor page seeds the store with it.
   */
  agentGatewayUrl?: string;
  agentId: string;
  agentMeta: {
    avatar: string | null;
    backgroundColor: string | null;
    description: string | null;
    marketIdentifier: string | null;
    name: string | null;
    slug: string | null;
    title: string | null;
  };
  /**
   * True when the share's budget is exhausted (or was never funded) in a
   * deployment that meters shared-agent usage. The visitor UI disables the
   * composer up front; the server rejects sends regardless.
   */
  budgetExhausted?: boolean;
  /** Whether the requesting user is the creator of the shared agent. */
  isOwner: boolean;
  shareId: string;
  visibility: ShareVisibility;
}
