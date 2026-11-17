import type { HeterogeneousProviderConfig } from '@lobechat/types';

/**
 * Whether the agent runs on subscription logins it can pick and balance across:
 * Claude Code in subscription mode (the default when no auth mode is stored).
 * API-key mode and other heterogeneous agents have no accounts to choose.
 */
export const usesAgentQuotaAccounts = (provider?: HeterogeneousProviderConfig): boolean =>
  provider?.type === 'claude-code' && (provider.authMode ?? 'subscription') === 'subscription';
