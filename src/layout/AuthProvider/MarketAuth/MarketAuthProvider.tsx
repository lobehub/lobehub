'use client';

import { App } from 'antd';
import { type ReactNode } from 'react';
import { createContext, use, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mutate as globalMutate } from 'swr';

import { lambdaClient } from '@/libs/trpc/client';
import { MARKET_OIDC_ENDPOINTS } from '@/services/_url';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors/settings';

import { MarketAuthError } from './errors';
import MarketAuthConfirmModal from './MarketAuthConfirmModal';
import { MarketOIDC } from './oidc';
import ProfileSetupModal from './ProfileSetupModal';
import {
  type MarketAuthContextType,
  type MarketAuthSession,
  type MarketUserInfo,
  type MarketUserProfile,
  type OIDCConfig,
} from './types';
import { useMarketUserProfile } from './useMarketUserProfile';

const MarketAuthContext = createContext<MarketAuthContextType | null>(null);

interface MarketAuthProviderProps {
  children: ReactNode;
  isDesktop: boolean;
}

/**
 * 获取用户信息（通过 tRPC OIDC endpoint）
 * @param accessToken - 可选的 access token，如果不传则后端会尝试使用 trustedClientToken
 */
const fetchUserInfo = async (accessToken?: string): Promise<MarketUserInfo | null> => {
  try {
    const userInfo = await lambdaClient.market.oidc.getUserInfo.mutate({
      token: accessToken,
    });

    return userInfo as MarketUserInfo;
  } catch (error) {
    console.error('[MarketAuth] Error fetching user info:', error);
    return null;
  }
};

/**
 * 从 DB 获取 market tokens
 */
const getMarketTokensFromDB = () => {
  const settings = settingsSelectors.currentSettings(useUserStore.getState());
  return settings.market;
};

/**
 * 存储 market tokens 到 DB
 */
const saveMarketTokensToDB = async (
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number,
) => {
  try {
    await useUserStore.getState().setSettings({
      market: {
        accessToken,
        expiresAt,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('[MarketAuth] Failed to save tokens to DB:', error);
  }
};

/**
 * 清除 DB 中的 market tokens
 */
const clearMarketTokensFromDB = async () => {
  // 如果已经没有 tokens，不需要调用 setSettings
  const currentTokens = getMarketTokensFromDB();
  if (!currentTokens?.accessToken && !currentTokens?.refreshToken && !currentTokens?.expiresAt) {
    return;
  }

  try {
    await useUserStore.getState().setSettings({
      market: undefined,
    });
  } catch (error) {
    console.error('[MarketAuth] Failed to clear tokens from DB:', error);
  }
};

/**
 * 获取 refresh token（优先从 DB 获取）
 */
const getRefreshToken = (): string | null => {
  // 优先从 DB 获取
  const dbTokens = getMarketTokensFromDB();
  if (dbTokens?.refreshToken) {
    return dbTokens.refreshToken;
  }

  return null;
};

/**
 * 刷新令牌（暂时简化，后续可以实现 refresh token 逻辑）
 */
const refreshToken = async (): Promise<boolean> => {
  return false;
};

/**
 * 检查用户是否需要设置用户名（首次登录）
 */
const checkNeedsProfileSetup = async (username: string): Promise<boolean> => {
  try {
    const profile = await lambdaClient.market.user.getUserByUsername.query({ username });
    // If userName is not set, user needs to complete profile setup
    return !profile.userName;
  } catch {
    // Error fetching profile (e.g., NOT_FOUND), assume needs setup
    return true;
  }
};

/**
 * Market 授权上下文提供者
 */
export const MarketAuthProvider = ({ children, isDesktop }: MarketAuthProviderProps) => {
  const { message } = App.useApp();
  const { t } = useTranslation('marketAuth');

  const [session, setSession] = useState<MarketAuthSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [oidcClient, setOidcClient] = useState<MarketOIDC | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showProfileSetupModal, setShowProfileSetupModal] = useState(false);
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState(false);
  const [pendingSignInResolve, setPendingSignInResolve] = useState<
    ((_value: number | null) => void) | null
  >(null);
  const [pendingSignInReject, setPendingSignInReject] = useState<((_reason?: any) => void) | null>(
    null,
  );
  const [pendingProfileSuccessCallback, setPendingProfileSuccessCallback] = useState<
    ((_profile: MarketUserProfile) => void) | null
  >(null);

  // 订阅 user store 的初始化状态，当 isUserStateInit 为 true 时，settings 数据已加载完成
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);

  // 检查是否启用了 Market Trusted Client 认证
  const enableMarketTrustedClient = useServerConfigStore(
    serverConfigSelectors.enableMarketTrustedClient,
  );

  // 初始化 OIDC 客户端（仅在客户端）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const baseUrl = process.env.NEXT_PUBLIC_MARKET_BASE_URL || 'https://market.lobehub.com';
      const desktopRedirectUri = new URL(MARKET_OIDC_ENDPOINTS.desktopCallback, baseUrl).toString();

      // 桌面端使用 Market 手动维护的 Web 回调，Web 端使用当前域名
      const redirectUri = isDesktop
        ? desktopRedirectUri
        : `${window.location.origin}/market-auth-callback`;

      const oidcConfig: OIDCConfig = {
        baseUrl,
        clientId: isDesktop ? 'lobehub-desktop' : 'lobechat-com',
        redirectUri,
        scope: 'openid profile email',
      };
      setOidcClient(new MarketOIDC(oidcConfig));
    }
  }, [isDesktop]);

  /**
   * 初始化：检查并恢复会话，获取用户信息
   */
  const initializeSession = async () => {
    setStatus('loading');

    // 如果启用了 Trusted Client 认证，直接通过后端获取用户信息（不传 token）
    if (enableMarketTrustedClient) {
      const userInfo = await fetchUserInfo();

      if (userInfo) {
        // 使用 Trusted Client 时，创建一个虚拟的 session（无需真实 token）
        const trustedSession: MarketAuthSession = {
          accessToken: '', // Trusted Client 不需要前端 token
          expiresAt: Number.MAX_SAFE_INTEGER, // 不过期
          expiresIn: Number.MAX_SAFE_INTEGER,
          scope: 'openid profile email',
          tokenType: 'Bearer',
          userInfo,
        };

        setSession(trustedSession);
        setStatus('authenticated');
        return;
      }

      // 如果获取失败，设置为未认证状态
      setStatus('unauthenticated');
      return;
    }

    // 原有的 OIDC token 认证流程
    const dbTokens = getMarketTokensFromDB();

    // 检查 DB 中是否有 token
    if (!dbTokens?.accessToken) {
      setStatus('unauthenticated');
      return;
    }

    // 检查 token 是否过期
    if (!dbTokens.expiresAt || dbTokens.expiresAt <= Date.now()) {
      // 清理过期的 DB tokens
      await clearMarketTokensFromDB();
      setStatus('unauthenticated');
      return;
    }

    // 获取用户信息
    const userInfo = await fetchUserInfo(dbTokens.accessToken);

    if (!userInfo) {
      // 清理无效的 token
      await clearMarketTokensFromDB();
      setStatus('unauthenticated');
      return;
    }

    const restoredSession: MarketAuthSession = {
      accessToken: dbTokens.accessToken,
      expiresAt: dbTokens.expiresAt,
      expiresIn: Math.floor((dbTokens.expiresAt - Date.now()) / 1000),
      scope: 'openid profile email',
      tokenType: 'Bearer',
      userInfo,
    };

    setSession(restoredSession);
    setStatus('authenticated');
  };

  /**
   * 实际执行登录的方法（内部使用）
   */
  const handleActualSignIn = async (): Promise<number | null> => {
    if (!oidcClient) {
      console.error('[MarketAuth] OIDC client not initialized');
      throw new MarketAuthError('oidcNotReady', { message: 'OIDC client not initialized' });
    }

    try {
      setStatus('loading');

      // 启动 OIDC 授权流程并获取授权码
      const authResult = await oidcClient.startAuthorization();

      // 用授权码换取访问令牌
      const tokenResponse = await oidcClient.exchangeCodeForToken(
        authResult.code,
        authResult.state,
      );

      // 获取用户信息
      const userInfo = await fetchUserInfo(tokenResponse.accessToken);

      // 创建会话对象
      const expiresAt = Date.now() + tokenResponse.expiresIn * 1000;
      const newSession: MarketAuthSession = {
        accessToken: tokenResponse.accessToken,
        expiresAt,
        expiresIn: tokenResponse.expiresIn,
        scope: tokenResponse.scope,
        tokenType: tokenResponse.tokenType as 'Bearer',
        userInfo: userInfo || undefined,
      };

      // 存储 tokens 到 DB
      await saveMarketTokensToDB(tokenResponse.accessToken, tokenResponse.refreshToken, expiresAt);

      setSession(newSession);
      setStatus('authenticated');

      // Check if user needs to set up profile (first-time login)
      if (userInfo?.sub) {
        const needsSetup = await checkNeedsProfileSetup(userInfo.sub);
        if (needsSetup) {
          // Wait for next tick to ensure session state is updated before opening modal
          // This prevents the edge case where accessToken is null when modal opens
          setTimeout(() => {
            setIsFirstTimeSetup(true);
            setShowProfileSetupModal(true);
          }, 0);
        }
      }

      return userInfo?.accountId ?? null;
    } catch (error) {
      setStatus('unauthenticated');

      // 根据错误类型显示不同的错误消息
      if (error instanceof MarketAuthError) {
        message.error(t(`errors.${error.code}`) || t('errors.general'));
      } else {
        message.error(t('errors.general'));
      }

      throw error;
    }
  };

  /**
   * 登录方法（会先弹出确认对话框）
   */
  const signIn = async (): Promise<number | null> => {
    return new Promise<number | null>((resolve, reject) => {
      setPendingSignInResolve(() => resolve);
      setPendingSignInReject(() => reject);
      setShowConfirmModal(true);
    });
  };

  /**
   * 处理确认授权
   */
  const handleConfirmAuth = async () => {
    setShowConfirmModal(false);

    // 如果是 trustedClient 模式，直接打开 ProfileSetupModal 完善资料
    if (enableMarketTrustedClient) {
      setIsFirstTimeSetup(true);
      setShowProfileSetupModal(true);
      if (pendingSignInResolve) {
        pendingSignInResolve(session?.userInfo?.accountId ?? null);
        setPendingSignInResolve(null);
        setPendingSignInReject(null);
      }
      return;
    }

    // 原有的 OIDC 流程
    try {
      const result = await handleActualSignIn();
      if (pendingSignInResolve) {
        pendingSignInResolve(result);
        setPendingSignInResolve(null);
        setPendingSignInReject(null);
      }
    } catch (error) {
      if (pendingSignInReject) {
        pendingSignInReject(error);
        setPendingSignInResolve(null);
        setPendingSignInReject(null);
      }
    }
  };

  /**
   * 处理取消授权
   */
  const handleCancelAuth = () => {
    setShowConfirmModal(false);
    if (pendingSignInReject) {
      pendingSignInReject(new Error('User cancelled authorization'));
      setPendingSignInResolve(null);
      setPendingSignInReject(null);
    }
  };

  /**
   * 登出方法
   */
  const signOut = async () => {
    setSession(null);
    setStatus('unauthenticated');
    await clearMarketTokensFromDB();
  };

  /**
   * 获取当前用户信息
   */
  const getCurrentUserInfo = (): MarketUserInfo | null => {
    return session?.userInfo ?? null;
  };

  /**
   * 获取 access token（优先从 session 获取，否则从 DB 获取）
   */
  const getAccessToken = (): string | null => {
    // 优先从 session 获取（内存中的状态）
    if (session?.accessToken) {
      return session.accessToken;
    }

    // 备选从 DB 获取
    const dbTokens = getMarketTokensFromDB();
    return dbTokens?.accessToken ?? null;
  };

  /**
   * 打开个人资料设置模态框（用于用户手动编辑）
   */
  const openProfileSetup = useCallback((onSuccess?: (profile: MarketUserProfile) => void) => {
    setIsFirstTimeSetup(false);
    setPendingProfileSuccessCallback(() => onSuccess || null);
    setShowProfileSetupModal(true);
  }, []);

  /**
   * 关闭个人资料设置模态框
   */
  const handleCloseProfileSetup = useCallback(() => {
    setShowProfileSetupModal(false);
    setIsFirstTimeSetup(false);
    setPendingProfileSuccessCallback(null);
  }, []);

  /**
   * 个人资料更新成功回调
   */
  const handleProfileUpdateSuccess = useCallback(() => {
    // Profile is updated, modal will close automatically
  }, []);

  /**
   * 初始化时恢复会话并获取用户信息
   * 等待 isUserStateInit 为 true，此时 useInitUserState 的 SWR 请求已完成，settings 数据已加载
   */
  useEffect(() => {
    if (isUserStateInit) {
      initializeSession();
    }
  }, [isUserStateInit, enableMarketTrustedClient]);

  const contextValue: MarketAuthContextType = {
    getAccessToken,
    getCurrentUserInfo,
    getRefreshToken,
    // 当启用 Trusted Client 认证时，自动视为已认证（后端会自动使用 trustedClientToken）
    isAuthenticated: enableMarketTrustedClient || status === 'authenticated',
    isLoading: status === 'loading',
    openProfileSetup,
    refreshToken,
    session,
    signIn,
    signOut,
    status,
  };

  // Get current user's profile for the edit modal
  const userInfo = session?.userInfo;
  const username = userInfo?.sub;
  const { data: userProfile, mutate: mutateUserProfile } = useMarketUserProfile(username);

  // Handle profile update success - also refresh the cached profile
  const handleProfileSuccess = useCallback(
    (profile: MarketUserProfile) => {
      handleProfileUpdateSuccess();
      // Update the SWR cache with the new profile
      mutateUserProfile(profile, false);

      // Also refresh the discover store's user profile cache
      // The discover store uses keys like 'user-profile-{locale}-{username}'
      if (profile.userName) {
        globalMutate(
          (key) =>
            typeof key === 'string' &&
            key.includes(`user-profile`) &&
            key.includes(profile.userName!),
          undefined,
          { revalidate: true },
        );
      }

      // Call the external success callback if provided
      if (pendingProfileSuccessCallback) {
        pendingProfileSuccessCallback(profile);
        setPendingProfileSuccessCallback(null);
      }
    },
    [handleProfileUpdateSuccess, mutateUserProfile, pendingProfileSuccessCallback],
  );

  return (
    <MarketAuthContext value={contextValue}>
      {children}
      <MarketAuthConfirmModal
        open={showConfirmModal}
        onCancel={handleCancelAuth}
        onConfirm={handleConfirmAuth}
      />
      <ProfileSetupModal
        accessToken={session?.accessToken ?? null}
        defaultDisplayName={userProfile?.displayName || ''}
        isFirstTimeSetup={isFirstTimeSetup}
        open={showProfileSetupModal}
        userProfile={userProfile}
        onClose={handleCloseProfileSetup}
        onSuccess={handleProfileSuccess}
      />
    </MarketAuthContext>
  );
};

/**
 * 使用 Market 授权的 Hook
 */
export const useMarketAuth = (): MarketAuthContextType => {
  const context = use(MarketAuthContext);
  if (!context) {
    throw new Error('useMarketAuth must be used within a MarketAuthProvider');
  }
  return context;
};
