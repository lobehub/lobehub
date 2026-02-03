import { useCallback, useEffect, useRef, useState } from 'react';

interface McpOAuthDiscoverResult {
  providerName?: string;
  requiresOAuth: boolean;
}

export interface UseMcpOAuthOptions {
  /** When true, skip discovery and fetch connection status immediately (e.g. when we already know the plugin is OAuth). */
  skipDiscover?: boolean;
}

export function useMcpOAuth(
  mcpUrl: string | undefined,
  pluginId: string,
  options: UseMcpOAuthOptions = {},
) {
  const { skipDiscover = false } = options;
  const [discoverResult, setDiscoverResult] = useState<McpOAuthDiscoverResult | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDiscover = useCallback(async (url: string) => {
    try {
      const res = await fetch(`/api/mcp/oauth/discover?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (data.requiresOAuth) {
        setDiscoverResult({
          providerName: data.providerName,
          requiresOAuth: true,
        });
      } else {
        setDiscoverResult({ requiresOAuth: false });
      }
    } catch {
      setDiscoverResult({ requiresOAuth: false });
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!pluginId) return;
    try {
      const res = await fetch(`/api/mcp/oauth/status?pluginId=${encodeURIComponent(pluginId)}`);
      if (res.ok) {
        const data = await res.json();
        setConnected(!!data.connected);
      }
    } catch {
      setConnected(false);
    }
  }, [pluginId]);

  // When skipDiscover, only fetch connection status (no discovery round-trip).
  useEffect(() => {
    if (!skipDiscover || !pluginId) return;
    fetchStatus();
  }, [skipDiscover, pluginId, fetchStatus]);

  useEffect(() => {
    if (skipDiscover || !mcpUrl || !pluginId) {
      if (!skipDiscover) {
        setDiscoverResult(null);
        setConnected(null);
      }
      return;
    }
    let valid = false;
    try {
      new URL(mcpUrl);
      valid = true;
    } catch {
      setDiscoverResult(null);
      setConnected(null);
      return;
    }
    if (!valid) return;
    setIsDiscovering(true);
    setDiscoverResult(null);
    fetchDiscover(mcpUrl);
  }, [skipDiscover, mcpUrl, pluginId, fetchDiscover]);

  useEffect(() => {
    if (skipDiscover) return;
    if (!discoverResult?.requiresOAuth || !pluginId) {
      setConnected(null);
      return;
    }
    fetchStatus();
  }, [skipDiscover, discoverResult?.requiresOAuth, pluginId, fetchStatus]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'MCP_OAUTH_SUCCESS' && event.data?.provider === pluginId) {
        setConnected(true);
        setIsConnecting(false);
        popupRef.current?.close();
        popupRef.current = null;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [pluginId]);

  const connect = useCallback(async () => {
    if (!mcpUrl || !pluginId || isConnecting) return;
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(pluginId)}&source=mcp`;
      const callbackBase =
        (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_APP_URL) ||
        window.location.origin;
      const res = await fetch('/api/mcp/oauth/authorize', {
        body: JSON.stringify({
          callbackBase,
          mcpUrl,
          pluginId,
          redirectUri,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Authorize failed');
      }
      const data = await res.json();
      const authUrl = data.authorizationUrl;
      if (!authUrl) throw new Error('No authorization URL');
      const popup = window.open(authUrl, '_blank', 'width=600,height=700');
      if (popup) {
        popupRef.current = popup;
        intervalRef.current = setInterval(() => {
          try {
            if (popup.closed) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              popupRef.current = null;
              setIsConnecting(false);
            }
          } catch {
            // no-op
          }
        }, 500);
      } else {
        setIsConnecting(false);
        throw new Error('Popup blocked');
      }
    } catch (error) {
      setIsConnecting(false);
      throw error;
    }
  }, [mcpUrl, pluginId, isConnecting]);

  return {
    connect,
    connected,
    discoverResult,
    fetchStatus,
    isConnecting,
    isDiscovering,
  };
}
