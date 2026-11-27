import type { AgentShareVisitorIds } from '@lobechat/types';

/** What a web browsing fee pays for: one search, or one crawled page. */
export type WebBrowsingFeeKind = 'crawl' | 'search';

/** Who pays for a web browsing call and where it came from. */
export interface WebBrowsingBillingContext {
  /** Set on a shared Agent's visitor run; projected ids only, never the visitor context. */
  agentShare?: AgentShareVisitorIds;
  operationId?: string;
  toolCallId?: string;
  topicId?: string;
  /** Request source (`chat`, `api`, `cron`, ...), as spend logs record it. */
  trigger?: string;
  userId: string;
  /** Bills the workspace instead of the user when set. */
  workspaceId?: string;
}

export interface HoldWebBrowsingFeeParams {
  /**
   * Every provider (search impl or crawler impl id) that may serve a unit of this call, so
   * the hold covers the most expensive one the fallback chain can reach.
   */
  candidates: string[];
  context: WebBrowsingBillingContext;
  kind: WebBrowsingFeeKind;
  /** Units the call may use: 1 for a search, the number of URLs for a crawl. */
  units: number;
}

/** Units one provider served. */
export interface WebBrowsingFeeUsage {
  provider: string;
  units: number;
}

export interface WebBrowsingFeeHold {
  /**
   * Charges the units that were served and gives back the rest of the hold. An empty list
   * (the call failed or found nothing) gives back the whole hold. Never throws.
   */
  settle: (usage: WebBrowsingFeeUsage[]) => Promise<void>;
}

/**
 * Holds the fee of a built-in web search or crawl before it reaches an upstream provider.
 * The default never charges and returns no hold; a deployment that bills these tools
 * overrides it.
 *
 * A deployment refuses a call it cannot fund by throwing an `Error` whose message the
 * model can relay to the user; nothing is held and no provider is called.
 */
export const holdWebBrowsingFee = async (
  _params: HoldWebBrowsingFeeParams,
): Promise<WebBrowsingFeeHold | undefined> => undefined;
