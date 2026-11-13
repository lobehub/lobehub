/**
 * DOM id of the agent's "subscription accounts" section on its Environment
 * page. The load balancer's "add accounts" hint scrolls to it there and links
 * to it (as the URL hash) from the chat bar's account manager.
 */
export const AGENT_QUOTA_ACCOUNTS_ANCHOR = 'agent-subscription-accounts';

export const agentQuotaAccountsUrl = (agentId: string) =>
  `/agent/${agentId}/environment#${AGENT_QUOTA_ACCOUNTS_ANCHOR}`;

/** Scrolls the subscription-accounts section into view; false when it is not mounted. */
export const scrollToAgentQuotaAccounts = (): boolean => {
  const el = document.getElementById(AGENT_QUOTA_ACCOUNTS_ANCHOR);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
};
