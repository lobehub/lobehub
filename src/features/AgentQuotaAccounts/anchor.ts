/**
 * DOM id of the agent's "subscription accounts" card on its `/accounts` page.
 * The load balancer's "add accounts" hint scrolls to it.
 */
export const AGENT_QUOTA_ACCOUNTS_ANCHOR = 'agent-subscription-accounts';

export const agentQuotaAccountsUrl = (agentId: string) =>
  `/agent/${agentId}/accounts#${AGENT_QUOTA_ACCOUNTS_ANCHOR}`;

/** Scrolls the subscription-accounts section into view; false when it is not mounted. */
export const scrollToAgentQuotaAccounts = (): boolean => {
  const el = document.getElementById(AGENT_QUOTA_ACCOUNTS_ANCHOR);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
};

/**
 * DOM id of the load-balancing card on the same page. The chat bar's quota
 * panel links here (as the URL hash) to switch the account a run uses.
 */
export const AGENT_LOAD_BALANCING_ANCHOR = 'agent-load-balancing';

export const agentLoadBalancingUrl = (agentId: string) =>
  `/agent/${agentId}/accounts#${AGENT_LOAD_BALANCING_ANCHOR}`;

/** Scrolls the load-balancing section into view; false when it is not mounted. */
export const scrollToAgentLoadBalancing = (): boolean => {
  const el = document.getElementById(AGENT_LOAD_BALANCING_ANCHOR);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
};
