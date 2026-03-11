import { Checkbox, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { Loader2, SquareArrowOutUpRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { type KlavisServer } from '@/store/tool/slices/klavisStore';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

// Polling configuration
const POLL_INTERVAL_MS = 1000; // Poll once per second
const POLL_TIMEOUT_MS = 15_000; // 15-second timeout

interface KlavisServerItemProps {
  /**
   * Optional agent ID to use instead of currentAgentConfig
   * Used in group profile to specify which member's plugins to toggle
   */
  agentId?: string;
  /**
   * Identifier used for storage (e.g., 'google-calendar')
   */
  identifier: string;
  label: string;
  server?: KlavisServer;
  /**
   * Server name used to call Klavis API (e.g., 'Google Calendar')
   */
  serverName: string;
}

const KlavisServerItem = memo<KlavisServerItemProps>(
  ({ identifier, label, server, serverName, agentId }) => {
    const { t } = useTranslation('setting');
    const [isConnecting, setIsConnecting] = useState(false);
    const [isToggling, setIsToggling] = useState(false);
    const [isWaitingAuth, setIsWaitingAuth] = useState(false);

    const oauthWindowRef = useRef<Window | null>(null);
    const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const userId = useUserStore(userProfileSelectors.userId);
    const createKlavisServer = useToolStore((s) => s.createKlavisServer);
    const refreshKlavisServerTools = useToolStore((s) => s.refreshKlavisServerTools);

    // Get effective agent ID (agentId prop or current active agent)
    const activeAgentId = useAgentStore((s) => s.activeAgentId);
    const effectiveAgentId = agentId || activeAgentId || '';

    // Clean up all timers
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

    // Clean up on component unmount
    useEffect(() => {
      return () => {
        cleanup();
      };
    }, [cleanup]);

    // Stop all listeners when server status becomes CONNECTED
    useEffect(() => {
      if (server?.status === KlavisServerStatus.CONNECTED && isWaitingAuth) {
        cleanup();
      }
    }, [server?.status, isWaitingAuth, cleanup, t]);

    /**
     * Start fallback polling (when window.closed is inaccessible)
     */
    const startFallbackPolling = useCallback(
      (serverName: string) => {
        // Already polling, don't start again
        if (pollIntervalRef.current) return;

        // Poll once per second
        pollIntervalRef.current = setInterval(async () => {
          try {
            await refreshKlavisServerTools(serverName);
          } catch (error) {
            console.info('[Klavis] Polling check (expected during auth):', error);
          }
        }, POLL_INTERVAL_MS);

        // Stop after 15-second timeout
        pollTimeoutRef.current = setTimeout(() => {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setIsWaitingAuth(false);
        }, POLL_TIMEOUT_MS);
      },
      [refreshKlavisServerTools, t],
    );

    /**
     * Monitor OAuth window close
     */
    const startWindowMonitor = useCallback(
      (oauthWindow: Window, serverName: string) => {
        // Check window state every 500ms
        windowCheckIntervalRef.current = setInterval(() => {
          try {
            // Try to access window.closed (may be blocked by COOP)
            if (oauthWindow.closed) {
              // Window closed, clean up listeners and check auth status
              if (windowCheckIntervalRef.current) {
                clearInterval(windowCheckIntervalRef.current);
                windowCheckIntervalRef.current = null;
              }
              oauthWindowRef.current = null;

              // Start polling to check auth status after window closes
              startFallbackPolling(serverName);
            }
          } catch {
            // COOP blocked access, falling back to polling
            console.info('[Klavis] COOP blocked window.closed access, falling back to polling');
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            startFallbackPolling(serverName);
          }
        }, 500);
      },
      [refreshKlavisServerTools, startFallbackPolling],
    );

    /**
     * Open OAuth window
     */
    const openOAuthWindow = useCallback(
      (oauthUrl: string, serverName: string) => {
        // Clean up previous state
        cleanup();
        setIsWaitingAuth(true);

        // Open OAuth window
        const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');
        if (oauthWindow) {
          oauthWindowRef.current = oauthWindow;
          startWindowMonitor(oauthWindow, serverName);
        } else {
          // Window blocked, use polling directly
          startFallbackPolling(serverName);
        }
      },
      [cleanup, startWindowMonitor, startFallbackPolling, t],
    );

    // Get plugin ID for this server (use identifier as pluginId)
    const pluginId = server ? server.identifier : '';
    const plugins =
      useAgentStore(agentSelectors.getAgentConfigById(effectiveAgentId))?.plugins || [];
    const checked = plugins.includes(pluginId);
    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

    // Toggle plugin for the effective agent
    const togglePlugin = useCallback(
      async (pluginIdToToggle: string) => {
        if (!effectiveAgentId) return;
        const currentPlugins = plugins;
        const hasPlugin = currentPlugins.includes(pluginIdToToggle);
        const newPlugins = hasPlugin
          ? currentPlugins.filter((id) => id !== pluginIdToToggle)
          : [...currentPlugins, pluginIdToToggle];
        await updateAgentConfigById(effectiveAgentId, { plugins: newPlugins });
      },
      [effectiveAgentId, plugins, updateAgentConfigById],
    );

    const handleConnect = async () => {
      if (!userId) {
        return;
      }

      if (server) {
        return;
      }

      setIsConnecting(true);
      try {
        const newServer = await createKlavisServer({
          identifier,
          serverName,
          userId,
        });

        if (newServer) {
          // Auto-enable plugin after installation (using identifier)
          const newPluginId = newServer.identifier;
          await togglePlugin(newPluginId);

          // If already authenticated, refresh tool list directly, skip OAuth
          if (newServer.isAuthenticated) {
            await refreshKlavisServerTools(newServer.identifier);
          } else if (newServer.oauthUrl) {
            // Need OAuth, open OAuth window and monitor close
            openOAuthWindow(newServer.oauthUrl, newServer.identifier);
          }
        }
      } catch (error) {
        console.error('[Klavis] Failed to connect server:', error);
      } finally {
        setIsConnecting(false);
      }
    };

    const handleToggle = async () => {
      if (!server) return;
      setIsToggling(true);
      await togglePlugin(pluginId);
      setIsToggling(false);
    };

    // Render right-side controls
    const renderRightControl = () => {
      // Connecting in progress
      if (isConnecting) {
        return (
          <Flexbox horizontal align="center" gap={4} onClick={stopPropagation}>
            <Icon spin icon={Loader2} />
          </Flexbox>
        );
      }

      // Not connected, show Connect button
      if (!server) {
        return (
          <Flexbox
            horizontal
            align="center"
            gap={4}
            style={{ cursor: 'pointer', opacity: 0.65 }}
            onClick={(e) => {
              e.stopPropagation();
              handleConnect();
            }}
          >
            {t('tools.klavis.connect', { defaultValue: 'Connect' })}
            <Icon icon={SquareArrowOutUpRight} size="small" />
          </Flexbox>
        );
      }

      // Show different controls based on status
      switch (server.status) {
        case KlavisServerStatus.CONNECTED: {
          // Toggling state
          if (isToggling) {
            return <Icon spin icon={Loader2} />;
          }
          return (
            <Checkbox
              checked={checked}
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
            />
          );
        }
        case KlavisServerStatus.PENDING_AUTH: {
          // Waiting for authentication
          if (isWaitingAuth) {
            return (
              <Flexbox horizontal align="center" gap={4} onClick={stopPropagation}>
                <Icon spin icon={Loader2} />
              </Flexbox>
            );
          }
          return (
            <Flexbox
              horizontal
              align="center"
              gap={4}
              style={{ cursor: 'pointer', opacity: 0.65 }}
              onClick={(e) => {
                e.stopPropagation();
                // Click to reopen OAuth window
                if (server.oauthUrl) {
                  openOAuthWindow(server.oauthUrl, server.identifier);
                }
              }}
            >
              {t('tools.klavis.pendingAuth', { defaultValue: 'Authorize' })}
              <Icon icon={SquareArrowOutUpRight} size="small" />
            </Flexbox>
          );
        }
        case KlavisServerStatus.ERROR: {
          return (
            <span style={{ color: 'red', fontSize: 12 }}>
              {t('tools.klavis.error', { defaultValue: 'Error' })}
            </span>
          );
        }
        default: {
          return null;
        }
      }
    };

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={24}
        justify={'space-between'}
        onClick={(e) => {
          e.stopPropagation();
          // If connected, clicking the row toggles state
          if (server?.status === KlavisServerStatus.CONNECTED) {
            handleToggle();
          }
        }}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          {label}
        </Flexbox>
        {renderRightControl()}
      </Flexbox>
    );
  },
);

export default KlavisServerItem;
