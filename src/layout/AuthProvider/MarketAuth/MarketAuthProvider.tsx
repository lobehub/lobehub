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

import ClaimResourcesModal from './ClaimResourcesModal';
import { MarketAuthError } from './errors';
import { marketAuthEvents } from './events';
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
import { type ClaimableResources } from './useSocialConnect';

const MarketAuthContext = createContext<MarketAuthContextType | null>(null);

interface MarketAuthProviderProps {
  children: ReactNode;
  isDesktop: boolean;
}

/**
 * Fetch user info (via tRPC OIDC endpoint)
 * @param accessToken - Optional access token; if not provided, the backend will attempt to use trustedClientToken
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
 * Get market tokens from DB
 */
const getMarketTokensFromDB = () => {
  const settings = settingsSelectors.currentSettings(useUserStore.getState());
  return settings.market;
};

/**
 * Store market tokens to DB
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
 * Clear market tokens from DB
 */
const clearMarketTokensFromDB = async () => {
  // If there are no tokens, no need to call setSettings
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
 * Get refresh token (prioritize DB)
 */
const getRefreshToken = (): string | null => {
  // Prioritize fetching from DB
  const dbTokens = getMarketTokensFromDB();
  if (dbTokens?.refreshToken) {
    return dbTokens.refreshToken;
  }

  return null;
};

/**
 * Check if the user needs to set up a username (first-time login)
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
 * Market authorization context provider
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
  const [claimableResources, setClaimableResources] = useState<ClaimableResources | null>(null);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [pendingClaimSuccessCallback, setPendingClaimSuccessCallback] = useState<
    (() => void) | null
  >(null);

  // Subscribe to user store init state; when isUserStateInit is true, settings data is fully loaded
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);

  // Check if Market Trusted Client authentication is enabled
  const enableMarketTrustedClient = useServerConfigStore(
    serverConfigSelectors.enableMarketTrustedClient,
  );

  // Initialize OIDC client (client-side only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const baseUrl = process.env.NEXT_PUBLIC_MARKET_BASE_URL || 'https://market.lobehub.com';
      const desktopRedirectUri = new URL(MARKET_OIDC_ENDPOINTS.desktopCallback, baseUrl).toString();

      // Desktop uses Market's manually maintained Web callback; Web uses the current domain
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
   * Try to refresh the access token using a refresh token
   * This is used during initialization when the access token is expired or invalid
   */
  const tryRefreshToken = async (refreshTokenValue: string): Promise<boolean> => {
    try {
      const clientId = isDesktop ? 'lobehub-desktop' : 'lobechat-com';

      const response = await lambdaClient.market.oidc.refreshToken.mutate({
        clientId,
        refreshToken: refreshTokenValue,
      });

      // Calculate new expiration time (default to 1 hour if not provided)
      const expiresIn = response.expiresIn ?? 3600;
      const expiresAt = Date.now() + expiresIn * 1000;

      // Save new tokens to DB
      await saveMarketTokensToDB(response.accessToken, response.refreshToken, expiresAt);

      // Fetch user info with new token
      const userInfo = await fetchUserInfo(response.accessToken);

      // Update session state
      const newSession: MarketAuthSession = {
        accessToken: response.accessToken,
        expiresAt,
        expiresIn,
        scope: response.scope || 'openid profile email',
        tokenType: 'Bearer',
        userInfo: userInfo || undefined,
      };

      setSession(newSession);
      setStatus('authenticated');

      console.info('[MarketAuth] Token refreshed successfully during initialization');
      return true;
    } catch (error) {
      console.error('[MarketAuth] Failed to refresh token during initialization:', error);
      return false;
    }
  };

  /**
   * Initialize: check and restore session, fetch user info
   */
  const initializeSession = async () => {
    setStatus('loading');

    // If Trusted Client authentication is enabled, fetch user info directly from backend (without token)
    if (enableMarketTrustedClient) {
      const userInfo = await fetchUserInfo();

      if (userInfo) {
        // When using Trusted Client, create a virtual session (no real token needed)
        const trustedSession: MarketAuthSession = {
          accessToken: '', // Trusted Client does not require a frontend token
          expiresAt: Number.MAX_SAFE_INTEGER, // never expires
          expiresIn: Number.MAX_SAFE_INTEGER,
          scope: 'openid profile email',
          tokenType: 'Bearer',
          userInfo,
        };

        setSession(trustedSession);
        setStatus('authenticated');
        return;
      }

      // If fetch fails, set to unauthenticated
      setStatus('unauthenticated');
      return;
    }

    // Original OIDC token authentication flow
    const dbTokens = getMarketTokensFromDB();

    // Check if token exists in DB
    if (!dbTokens?.accessToken) {
      setStatus('unauthenticated');
      return;
    }

    // Check if token is expired
    if (!dbTokens.expiresAt || dbTokens.expiresAt <= Date.now()) {
      // Try to refresh the token if refresh token is available
      if (dbTokens.refreshToken) {
        console.info('[MarketAuth] Access token expired, attempting refresh...');
        const refreshed = await tryRefreshToken(dbTokens.refreshToken);
        if (refreshed) {
          return; // Session already updated in tryRefreshToken
        }
      }

      // Clear expired DB tokens if refresh failed or no refresh token
      await clearMarketTokensFromDB();
      setStatus('unauthenticated');
      return;
    }

    // Fetch user info
    const userInfo = await fetchUserInfo(dbTokens.accessToken);

    if (!userInfo) {
      // Token might be invalid, try to refresh
      if (dbTokens.refreshToken) {
        console.info('[MarketAuth] Access token invalid, attempting refresh...');
        const refreshed = await tryRefreshToken(dbTokens.refreshToken);
        if (refreshed) {
          return; // Session already updated in tryRefreshToken
        }
      }

      // Clear invalid token if refresh failed
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
   * The actual sign-in method (internal use)
   */
  const handleActualSignIn = async (): Promise<number | null> => {
    if (!oidcClient) {
      console.error('[MarketAuth] OIDC client not initialized');
      throw new MarketAuthError('oidcNotReady', { message: 'OIDC client not initialized' });
    }

    try {
      setStatus('loading');

      // Start OIDC authorization flow and get authorization code
      const authResult = await oidcClient.startAuthorization();

      // Exchange authorization code for access token
      const tokenResponse = await oidcClient.exchangeCodeForToken(
        authResult.code,
        authResult.state,
      );

      // Fetch user info
      const userInfo = await fetchUserInfo(tokenResponse.accessToken);

      // Create session object
      const expiresAt = Date.now() + tokenResponse.expiresIn * 1000;
      const newSession: MarketAuthSession = {
        accessToken: tokenResponse.accessToken,
        expiresAt,
        expiresIn: tokenResponse.expiresIn,
        scope: tokenResponse.scope,
        tokenType: tokenResponse.tokenType as 'Bearer',
        userInfo: userInfo || undefined,
      };

      // Store tokens to DB
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

      // Display different error messages based on error type
      if (error instanceof MarketAuthError) {
        message.error(t(`errors.${error.code}`) || t('errors.general'));
      } else {
        message.error(t('errors.general'));
      }

      throw error;
    }
  };

  /**
   * Sign-in method (shows confirmation dialog first)
   */
  const signIn = useCallback(async (): Promise<number | null> => {
    return new Promise<number | null>((resolve, reject) => {
      setPendingSignInResolve(() => resolve);
      setPendingSignInReject(() => reject);
      setShowConfirmModal(true);
    });
  }, []);

  /**
   * Handle authorization confirmation
   */
  const handleConfirmAuth = async () => {
    setShowConfirmModal(false);

    // If in trustedClient mode, open ProfileSetupModal directly to complete profile
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

    // Original OIDC flow
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
   * Handle authorization cancellation
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
   * Sign-out method
   */
  const signOut = async () => {
    setSession(null);
    setStatus('unauthenticated');
    await clearMarketTokensFromDB();
  };

  /**
   * Get current user info
   */
  const getCurrentUserInfo = (): MarketUserInfo | null => {
    return session?.userInfo ?? null;
  };

  /**
   * Get access token (prioritize session, fallback to DB)
   */
  const getAccessToken = (): string | null => {
    // Prioritize fetching from session (in-memory state)
    if (session?.accessToken) {
      return session.accessToken;
    }

    // Fallback to fetching from DB
    const dbTokens = getMarketTokensFromDB();
    return dbTokens?.accessToken ?? null;
  };

  /**
   * Open profile setup modal (for manual user editing)
   */
  const openProfileSetup = useCallback((onSuccess?: (profile: MarketUserProfile) => void) => {
    setIsFirstTimeSetup(false);
    setPendingProfileSuccessCallback(() => onSuccess || null);
    setShowProfileSetupModal(true);
  }, []);

  /**
   * Close profile setup modal
   */
  const handleCloseProfileSetup = useCallback(() => {
    setShowProfileSetupModal(false);
    setIsFirstTimeSetup(false);
    setPendingProfileSuccessCallback(null);
  }, []);

  /**
   * Show claim resources modal (called from ProfileSetupModal after save)
   */
  const handleShowClaimResources = useCallback((resources: ClaimableResources) => {
    setClaimableResources(resources);
    setShowClaimModal(true);
  }, []);

  /**
   * Close claim resources modal
   */
  const handleCloseClaimModal = useCallback(() => {
    setShowClaimModal(false);
    setClaimableResources(null);
    setPendingClaimSuccessCallback(null);
  }, []);

  /**
   * Handle claim success - refresh user profile data
   */
  const handleClaimSuccess = useCallback(() => {
    setShowClaimModal(false);
    setClaimableResources(null);

    // Call the pending success callback if provided (e.g., page-level mutate)
    if (pendingClaimSuccessCallback) {
      pendingClaimSuccessCallback();
      setPendingClaimSuccessCallback(null);
    }

    // Also refresh all user-profile related SWR cache as fallback
    globalMutate((key) => typeof key === 'string' && key.startsWith('user-profile'), undefined, {
      revalidate: true,
    });
  }, [pendingClaimSuccessCallback]);

  /**
   * Check for claimable resources and show modal if any found
   * Call this when user enters their profile page
   * @param onClaimSuccess - Optional callback to run after successful claim (e.g., to refresh page data)
   */
  const checkAndShowClaimableResources = useCallback(
    async (onClaimSuccess?: () => void): Promise<boolean> => {
      // Only check if user is authenticated
      if (status !== 'authenticated') {
        return false;
      }

      try {
        const result = await lambdaClient.market.socialProfile.scanClaimableResources.query();
        if (result.plugins.length > 0 || result.skills.length > 0) {
          // Store the callback for when claim succeeds
          if (onClaimSuccess) {
            setPendingClaimSuccessCallback(() => onClaimSuccess);
          }
          setClaimableResources(result);
          setShowClaimModal(true);
          return true;
        }
        return false;
      } catch (error) {
        console.error('[MarketAuth] Failed to check claimable resources:', error);
        return false;
      }
    },
    [status],
  );

  /**
   * Profile update success callback
   */
  const handleProfileUpdateSuccess = useCallback(() => {
    // Profile is updated, modal will close automatically
  }, []);

  /**
   * Refresh access token using refresh token
   * Returns true if refresh was successful, false otherwise
   */
  const refreshToken = useCallback(async (): Promise<boolean> => {
    const dbTokens = getMarketTokensFromDB();

    // No refresh token available
    if (!dbTokens?.refreshToken) {
      console.warn('[MarketAuth] No refresh token available');
      return false;
    }

    try {
      const clientId = isDesktop ? 'lobehub-desktop' : 'lobechat-com';

      const response = await lambdaClient.market.oidc.refreshToken.mutate({
        clientId,
        refreshToken: dbTokens.refreshToken,
      });

      // Calculate new expiration time (default to 1 hour if not provided)
      const expiresIn = response.expiresIn ?? 3600;
      const expiresAt = Date.now() + expiresIn * 1000;

      // Save new tokens to DB
      await saveMarketTokensToDB(response.accessToken, response.refreshToken, expiresAt);

      // Fetch user info with new token
      const userInfo = await fetchUserInfo(response.accessToken);

      // Update session state
      const newSession: MarketAuthSession = {
        accessToken: response.accessToken,
        expiresAt,
        expiresIn,
        scope: response.scope || 'openid profile email',
        tokenType: 'Bearer',
        userInfo: userInfo || undefined,
      };

      setSession(newSession);
      setStatus('authenticated');

      console.info('[MarketAuth] Token refreshed successfully');
      return true;
    } catch (error) {
      console.error('[MarketAuth] Failed to refresh token:', error);
      // Clear invalid tokens
      await clearMarketTokensFromDB();
      setSession(null);
      setStatus('unauthenticated');
      return false;
    }
  }, [isDesktop]);

  /**
   * Handle unauthorized (401) error from Market API
   * Attempts to refresh token first, then triggers signIn if refresh fails
   * @returns true if successfully re-authenticated, false if user cancelled or failed
   */
  const handleUnauthorized = useCallback(async (): Promise<boolean> => {
    console.info('[MarketAuth] Handling unauthorized error, attempting recovery...');

    // First try to refresh the token
    const refreshed = await refreshToken();
    if (refreshed) {
      console.info('[MarketAuth] Token refresh successful, recovered from 401');
      return true;
    }

    // Refresh failed, need to re-authenticate
    console.info('[MarketAuth] Token refresh failed, triggering signIn...');
    try {
      const accountId = await signIn();
      if (accountId !== null) {
        console.info('[MarketAuth] Re-authentication successful');
        return true;
      }
      return false;
    } catch (error) {
      console.error('[MarketAuth] Re-authentication failed:', error);
      return false;
    }
  }, [refreshToken, signIn]);

  /**
   * Restore session and fetch user info on initialization
   * Wait for isUserStateInit to be true, at which point the SWR request from useInitUserState is complete and settings data is loaded
   */
  useEffect(() => {
    if (isUserStateInit) {
      initializeSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUserStateInit, enableMarketTrustedClient]);

  /**
   * Auto-refresh token before expiration
   * Refreshes the token 5 minutes before it expires to ensure continuous access
   */
  useEffect(() => {
    // Skip if using trusted client (no token expiration)
    if (enableMarketTrustedClient) return;

    // Skip if not authenticated or no session
    if (status !== 'authenticated' || !session?.expiresAt) return;

    const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiration
    const timeUntilExpiry = session.expiresAt - Date.now();
    const timeUntilRefresh = timeUntilExpiry - REFRESH_BUFFER_MS;

    // If token is already expired or will expire very soon, refresh immediately
    if (timeUntilRefresh <= 0) {
      refreshToken();
      return;
    }

    // Set a timer to refresh the token before it expires
    const refreshTimer = setTimeout(() => {
      console.info('[MarketAuth] Auto-refreshing token before expiration...');
      refreshToken();
    }, timeUntilRefresh);

    return () => {
      clearTimeout(refreshTimer);
    };
  }, [status, session?.expiresAt, enableMarketTrustedClient, refreshToken]);

  /**
   * Listen for market-unauthorized events from tRPC error handler
   * Automatically attempt to recover from 401 errors
   */
  useEffect(() => {
    const unsubscribe = marketAuthEvents.on('market-unauthorized', async (event) => {
      console.info('[MarketAuth] Received unauthorized event for path:', event.path);
      // Desktop: do not open community auth / profile modals from background API 401s.
      // Only attempt a silent token refresh; Lobe cloud re-auth is handled separately (AuthRequiredModal).
      if (isDesktop) {
        const refreshed = await refreshToken();
        if (!refreshed) {
          console.info(
            '[MarketAuth] Desktop: market 401 — refresh failed, skipping community sign-in UI',
          );
        }
        return;
      }
      await handleUnauthorized();
    });

    return unsubscribe;
  }, [handleUnauthorized, isDesktop, refreshToken]);

  const contextValue: MarketAuthContextType = {
    checkAndShowClaimableResources,
    getAccessToken,
    getCurrentUserInfo,
    getRefreshToken,
    handleUnauthorized,
    // When Trusted Client authentication is enabled, automatically treat as authenticated (backend uses trustedClientToken)
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
        onShowClaimResources={handleShowClaimResources}
        onSuccess={handleProfileSuccess}
      />
      {claimableResources && (
        <ClaimResourcesModal
          open={showClaimModal}
          resources={claimableResources}
          onClose={handleCloseClaimModal}
          onSuccess={handleClaimSuccess}
        />
      )}
    </MarketAuthContext>
  );
};

/**
 * Hook for using Market authorization
 */
export const useMarketAuth = (): MarketAuthContextType => {
  const context = use(MarketAuthContext);
  if (!context) {
    throw new Error('useMarketAuth must be used within a MarketAuthProvider');
  }
  return context;
};
