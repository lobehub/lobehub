import { useEffect, useState } from 'react';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import type {MarketAuthContextType} from '@/layout/AuthProvider/MarketAuth/types';
import { marketApiService } from '@/services/marketApi';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

interface AgentOwnershipResult {
  // null = loading, true = user owns it, false = user doesn't own it
  error?: string;
  isOwnAgent: boolean | null;
}

// Simple cache mechanism to avoid duplicate API calls
const agentOwnershipCache = new Map<string, { result: boolean; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5-minute cache

const buildCacheKey = (marketIdentifier: string, accountId?: string | number | null) =>
  `${marketIdentifier}::${accountId ?? 'unknown'}`;

/**
 * Get current user ID
 */
function getCurrentAccountId(marketAuth: MarketAuthContextType): string | number | null {
  try {
    // First try to get user info from marketAuth
    const userInfo = marketAuth.getCurrentUserInfo?.();
    if (userInfo?.accountId !== null) {
      console.log('[useAgentOwnershipCheck] User ID from userInfo:', userInfo?.accountId);
      return userInfo?.accountId ?? null;
    }

    // If not available, try to get from sessionStorage
    const userInfoData = sessionStorage.getItem('market_user_info');
    if (userInfoData) {
      const parsedUserInfo = JSON.parse(userInfoData);
      console.log(
        '[useAgentOwnershipCheck] User ID from sessionStorage:',
        parsedUserInfo.accountId,
      );
      return parsedUserInfo.accountId ?? parsedUserInfo.sub ?? null;
    }

    console.warn('[useAgentOwnershipCheck] No user ID found');
    return null;
  } catch (error) {
    console.error('[useAgentOwnershipCheck] Failed to get current user ID:', error);
    return null;
  }
}

interface CheckOwnershipParams {
  accessToken?: string;
  accountId?: string | number | null;
  /**
   * Whether trustedClient mode is enabled; when enabled, accessToken is not required
   */
  enableMarketTrustedClient?: boolean;
  marketIdentifier?: string;
  skipCache?: boolean;
}

/**
 * Verify if the current account is the owner of the specified agent
 */
export const checkOwnership = async ({
  accountId,
  accessToken,
  enableMarketTrustedClient = false,
  marketIdentifier,
  skipCache = false,
}: CheckOwnershipParams): Promise<boolean> => {
  // In trustedClient mode, accessToken is not required; otherwise it is required
  if (!marketIdentifier || !accountId || (!enableMarketTrustedClient && !accessToken)) {
    console.warn('[checkOwnership] Missing required parameters', {
      accessToken: Boolean(accessToken),
      accountId,
      enableMarketTrustedClient,
      marketIdentifier,
    });
    return false;
  }

  const cacheKey = buildCacheKey(marketIdentifier, accountId);
  const cached = agentOwnershipCache.get(cacheKey);
  if (!skipCache && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[checkOwnership] Using cached result:', cached.result);
    return cached.result;
  }

  // Only set accessToken when not in trustedClient mode
  if (!enableMarketTrustedClient && accessToken) {
    marketApiService.setAccessToken(accessToken);
  }

  const agentDetail = await marketApiService.getAgentDetail(marketIdentifier);
  console.log('[checkOwnership] Agent detail:', agentDetail);

  const isOwner = `${agentDetail?.ownerId ?? ''}` === `${accountId}`;
  agentOwnershipCache.set(cacheKey, {
    result: isOwner,
    timestamp: Date.now(),
  });

  return isOwner;
};

/**
 * Check if the current user owns the specified agent
 */
export const useAgentOwnershipCheck = (marketIdentifier?: string): AgentOwnershipResult => {
  const [result, setResult] = useState<AgentOwnershipResult>({ isOwnAgent: null });
  const marketAuth = useMarketAuth();
  const { isAuthenticated } = marketAuth;

  // Check if Market Trusted Client authentication is enabled
  const enableMarketTrustedClient = useServerConfigStore(
    serverConfigSelectors.enableMarketTrustedClient,
  );

  useEffect(() => {
    if (!marketIdentifier || !isAuthenticated) {
      setResult({ isOwnAgent: false });
      return;
    }

    const runOwnershipCheck = async () => {
      try {
        console.log('[useAgentOwnershipCheck] Checking ownership for:', marketIdentifier);

        // Get current user ID
        const currentAccountId = getCurrentAccountId(marketAuth);
        console.log('[useAgentOwnershipCheck] Current user ID:', currentAccountId);

        if (!currentAccountId) {
          console.warn('[useAgentOwnershipCheck] Could not get current user ID');
          setResult({ isOwnAgent: false });
          return;
        }

        // No need to get accessToken in trustedClient mode
        const accessToken = enableMarketTrustedClient
          ? undefined
          : (marketAuth.getAccessToken() ?? undefined);

        const isOwner = await checkOwnership({
          accessToken,
          accountId: currentAccountId,
          enableMarketTrustedClient,
          marketIdentifier,
        });

        setResult({ isOwnAgent: isOwner });
      } catch (error) {
        setResult({
          error: error instanceof Error ? error.message : 'Unknown error',
          isOwnAgent: false,
        });
      }
    };

    runOwnershipCheck();
  }, [marketIdentifier, isAuthenticated, marketAuth, enableMarketTrustedClient]);

  return result;
};
