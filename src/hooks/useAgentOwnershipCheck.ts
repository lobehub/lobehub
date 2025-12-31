import { useEffect, useState } from 'react';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { type MarketAuthContextType } from '@/layout/AuthProvider/MarketAuth/types';
import { marketApiService } from '@/services/marketApi';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

interface AgentOwnershipResult {
  // null = loading, true = 是用户的, false = 不是用户的
  error?: string;
  isOwnAgent: boolean | null;
}

// 简单的缓存机制避免重复 API 调用
const agentOwnershipCache = new Map<string, { result: boolean; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

const buildCacheKey = (marketIdentifier: string, accountId?: string | number | null) =>
  `${marketIdentifier}::${accountId ?? 'unknown'}`;

/**
 * 获取当前用户 ID
 */
function getCurrentAccountId(marketAuth: MarketAuthContextType): string | number | null {
  try {
    // 首先尝试从 marketAuth 中获取用户信息
    const userInfo = marketAuth.getCurrentUserInfo?.();
    if (userInfo?.accountId !== null) {
      console.log('[useAgentOwnershipCheck] User ID from userInfo:', userInfo?.accountId);
      return userInfo?.accountId ?? null;
    }

    // 如果没有，尝试从 sessionStorage 中获取
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
   * 是否启用了 trustedClient 模式，启用时不需要 accessToken
   */
  enableMarketTrustedClient?: boolean;
  marketIdentifier?: string;
  skipCache?: boolean;
}

/**
 * 校验当前账号是否为指定 agent 的 owner
 */
export const checkOwnership = async ({
  accountId,
  accessToken,
  enableMarketTrustedClient = false,
  marketIdentifier,
  skipCache = false,
}: CheckOwnershipParams): Promise<boolean> => {
  // 在 trustedClient 模式下，不需要 accessToken；否则需要
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

  // 只有在非 trustedClient 模式下才设置 accessToken
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
 * 检查当前用户是否拥有指定的 agent
 */
export const useAgentOwnershipCheck = (marketIdentifier?: string): AgentOwnershipResult => {
  const [result, setResult] = useState<AgentOwnershipResult>({ isOwnAgent: null });
  const marketAuth = useMarketAuth();
  const { isAuthenticated } = marketAuth;

  // 检查是否启用了 Market Trusted Client 认证
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

        // 获取当前用户 ID
        const currentAccountId = getCurrentAccountId(marketAuth);
        console.log('[useAgentOwnershipCheck] Current user ID:', currentAccountId);

        if (!currentAccountId) {
          console.warn('[useAgentOwnershipCheck] Could not get current user ID');
          setResult({ isOwnAgent: false });
          return;
        }

        // trustedClient 模式下不需要获取 accessToken
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
