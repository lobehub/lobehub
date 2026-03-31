'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { lambdaClient, toolsClient } from '@/libs/trpc/client';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;
const SOCIAL_PROFILE_AUTH_CALLBACK = 'SOCIAL_PROFILE_AUTH_CALLBACK';
const SOCIAL_PROFILE_AUTH_ERROR = 'SOCIAL_PROFILE_AUTH_ERROR';

export type SocialProvider = 'github' | 'twitter';

export interface SocialProfile {
  avatarUrl?: string;
  connectedAt?: string;
  id: string;
  profileUrl?: string;
  provider: SocialProvider;
  username: string;
}

export interface ClaimableResource {
  description?: string;
  id: number;
  identifier: string;
  name?: string;
  parsedUrl?: {
    fullName: string;
    owner: string;
    repo: string;
  };
  type: 'plugin' | 'skill';
  url?: string;
}

export interface ClaimableResources {
  plugins: ClaimableResource[];
  skills: ClaimableResource[];
}

interface UseSocialConnectOptions {
  onClaimableResourcesFound?: (resources: ClaimableResources) => void;
  onConnectSuccess?: (profile: SocialProfile) => void;
  onDisconnectSuccess?: () => void;
  provider: SocialProvider;
}

export const useSocialConnect = ({
  provider,
  onConnectSuccess,
  onDisconnectSuccess,
  onClaimableResourcesFound,
}: UseSocialConnectOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authCompletedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (windowCheckIntervalRef.current) {
      clearInterval(windowCheckIntervalRef.current);
      windowCheckIntervalRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    oauthWindowRef.current = null;
    setIsWaitingAuth(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Fetch current profile status using existing connect API
  const fetchProfile = useCallback(async () => {
    try {
      const result = await toolsClient.market.connectGetStatus.query({ provider });
      if (result.connected && result.connection) {
        const profile: SocialProfile = {
          id: provider,
          provider: provider as SocialProvider,
          username: result.connection.providerUsername || provider,
        };
        setProfile(profile);
        return profile;
      }
      setProfile(null);
      return null;
    } catch (err) {
      console.error('[SocialConnect] Failed to fetch profile:', err);
      setProfile(null);
      return null;
    }
  }, [provider]);

  // Check for claimable resources
  const checkClaimableResources = useCallback(async () => {
    try {
      const result = await lambdaClient.market.socialProfile.scanClaimableResources.query();
      if (result.plugins.length > 0 || result.skills.length > 0) {
        onClaimableResourcesFound?.(result);
      }
      return result;
    } catch (err) {
      console.error('[SocialConnect] Failed to scan claimable resources:', err);
      return { plugins: [], skills: [] };
    }
  }, [onClaimableResourcesFound]);

  const handleConnectedProfile = useCallback(
    async (newProfile: SocialProfile) => {
      if (authCompletedRef.current) return;

      authCompletedRef.current = true;
      cleanup();
      setProfile(newProfile);
      onConnectSuccess?.(newProfile);
      await checkClaimableResources();
    },
    [checkClaimableResources, cleanup, onConnectSuccess],
  );

  const confirmConnection = useCallback(async () => {
    const newProfile = await fetchProfile();

    if (!newProfile) return false;

    await handleConnectedProfile(newProfile);

    return true;
  }, [fetchProfile, handleConnectedProfile]);

  // Fallback polling when popup callback arrives before the connection state is queryable
  const startFallbackPolling = useCallback(() => {
    if (pollIntervalRef.current || authCompletedRef.current) return;

    setIsWaitingAuth(true);

    const runCheck = async () => {
      try {
        await confirmConnection();
      } catch (err) {
        console.error('[SocialConnect] Polling check failed:', err);
      }
    };

    pollIntervalRef.current = setInterval(runCheck, POLL_INTERVAL_MS);
    void runCheck();

    pollTimeoutRef.current = setTimeout(() => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (!authCompletedRef.current) {
        setIsWaitingAuth(false);
      }
    }, POLL_TIMEOUT_MS);
  }, [confirmConnection]);

  // Listen for OAuth success message from popup window
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (event.data?.provider !== provider) return;

      if (event.data?.type === SOCIAL_PROFILE_AUTH_CALLBACK) {
        startFallbackPolling();
      }

      if (event.data?.type === SOCIAL_PROFILE_AUTH_ERROR) {
        cleanup();
        setError(event.data?.error || 'Failed to connect');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [cleanup, provider, startFallbackPolling]);

  // Monitor OAuth window close
  const startWindowMonitor = useCallback(
    (oauthWindow: Window) => {
      windowCheckIntervalRef.current = setInterval(async () => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;
            // Check if OAuth was successful
            const connected = await confirmConnection();
            if (!connected) {
              startFallbackPolling();
            }
          }
        } catch {
          // COOP headers prevent access to window.closed
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current);
            windowCheckIntervalRef.current = null;
          }
          startFallbackPolling();
        }
      }, 500);
    },
    [confirmConnection, startFallbackPolling],
  );

  // Open OAuth popup window
  const openOAuthWindow = useCallback(
    (oauthUrl: string) => {
      cleanup();
      authCompletedRef.current = false;
      setIsWaitingAuth(true);
      setError(null);

      const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow);
      } else {
        // Popup blocked, fall back to polling
        startFallbackPolling();
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
  );

  // Connect handler using existing connect API
  const connect = useCallback(async () => {
    if (profile) return; // Already connected

    setIsConnecting(true);
    setError(null);

    try {
      const redirectUri = `${window.location.origin}/oauth/callback/social?provider=${encodeURIComponent(provider)}`;
      const result = await toolsClient.market.connectGetAuthorizeUrl.query({
        provider,
        redirectUri,
      });

      if (result.authorizeUrl) {
        openOAuthWindow(result.authorizeUrl);
      } else {
        throw new Error('No authorize URL returned');
      }
    } catch (err) {
      console.error('[SocialConnect] Failed to get authorize URL:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setIsConnecting(false);
    }
  }, [provider, profile, openOAuthWindow]);

  // Disconnect handler using existing connect API
  const disconnect = useCallback(async () => {
    if (!profile) return;

    setIsDisconnecting(true);
    setError(null);

    try {
      await toolsClient.market.connectRevoke.mutate({ provider });
      setProfile(null);
      onDisconnectSuccess?.();
    } catch (err) {
      console.error('[SocialConnect] Failed to disconnect:', err);
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setIsDisconnecting(false);
    }
  }, [profile, provider, onDisconnectSuccess]);

  return {
    connect,
    disconnect,
    error,
    fetchProfile,
    isConnected: !!profile,
    isConnecting: isConnecting || isWaitingAuth,
    isDisconnecting,
    profile,
  };
};

export default useSocialConnect;
