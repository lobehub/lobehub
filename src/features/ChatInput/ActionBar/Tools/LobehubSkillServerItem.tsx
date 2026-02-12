import { Checkbox, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { Loader2, SquareArrowOutUpRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

interface LobehubSkillServerItemProps {
  /**
   * Optional agent ID to use instead of currentAgentConfig
   * Used in group profile to specify which member's plugins to toggle
   */
  agentId?: string;
  /**
   * Display label for the provider
   */
  label: string;
  /**
   * Provider ID (e.g., 'linear', 'github')
   */
  provider: string;
}

const LobehubSkillServerItem = memo<LobehubSkillServerItemProps>(({ provider, label, agentId }) => {
  const { t } = useTranslation('setting');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const server = useToolStore(lobehubSkillStoreSelectors.getServerByIdentifier(provider));
  const checkStatus = useToolStore((s) => s.checkLobehubSkillStatus);
  const getAuthorizeUrl = useToolStore((s) => s.getLobehubSkillAuthorizeUrl);

  // Get effective agent ID (agentId prop or current active agent)
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const effectiveAgentId = agentId || activeAgentId || '';

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

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  useEffect(() => {
    if (server?.status === LobehubSkillStatus.CONNECTED && isWaitingAuth) {
      cleanup();
    }
  }, [server?.status, isWaitingAuth, cleanup]);

  const startFallbackPolling = useCallback(() => {
    if (pollIntervalRef.current) return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        await checkStatus(provider);
      } catch (error) {
        console.error('[LobehubSkill] Failed to check status:', error);
      }
    }, POLL_INTERVAL_MS);

    pollTimeoutRef.current = setTimeout(() => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsWaitingAuth(false);
    }, POLL_TIMEOUT_MS);
  }, [checkStatus, provider]);

  const startWindowMonitor = useCallback(
    (oauthWindow: Window) => {
      windowCheckIntervalRef.current = setInterval(() => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;
            checkStatus(provider);
          }
        } catch {
          console.log('[LobehubSkill] COOP blocked window.closed access, falling back to polling');
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current);
            windowCheckIntervalRef.current = null;
          }
          startFallbackPolling();
        }
      }, 500);
    },
    [checkStatus, provider, startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (authorizeUrl: string) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(authorizeUrl, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow);
      } else {
        startFallbackPolling();
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
  );

  const pluginId = server ? server.identifier : '';
  const plugins = useAgentStore(agentSelectors.getAgentConfigById(effectiveAgentId))?.plugins || [];
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

  // Listen for OAuth success message from popup window
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'LOBEHUB_SKILL_AUTH_SUCCESS' && event.data?.provider === provider) {
        console.log('[LobehubSkill] OAuth success message received for provider:', provider);

        // Cleanup polling/window monitoring
        cleanup();

        // Refresh status to get the connected state
        await checkStatus(provider);

        // Auto-enable the plugin after successful OAuth
        // Need to get the latest server state after checkStatus
        const latestServer = useToolStore
          .getState()
          .lobehubSkillServers?.find((s) => s.identifier === provider);
        if (latestServer?.status === LobehubSkillStatus.CONNECTED) {
          const newPluginId = latestServer.identifier;
          const currentAgentPlugins =
            agentSelectors.getAgentConfigById(effectiveAgentId)(useAgentStore.getState())
              ?.plugins || [];
          const isAlreadyEnabled = currentAgentPlugins.includes(newPluginId);
          if (!isAlreadyEnabled) {
            console.log('[LobehubSkill] Auto-enabling plugin:', newPluginId);
            togglePlugin(newPluginId);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [provider, cleanup, checkStatus, togglePlugin, effectiveAgentId]);

  const handleConnect = async () => {
    // 只有已连接状态才阻止重新连接
    if (server?.isConnected) return;

    setIsConnecting(true);
    try {
      // Use /oauth/callback/success as redirect URI with provider param for auto-enable
      const redirectUri = `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(provider)}`;
      const { authorizeUrl } = await getAuthorizeUrl(provider, { redirectUri });
      openOAuthWindow(authorizeUrl);
    } catch (error) {
      console.error('[LobehubSkill] Failed to get authorize URL:', error);
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

  const renderRightControl = () => {
    if (isConnecting) {
      return (
        <Flexbox horizontal align="center" gap={4} onClick={stopPropagation}>
          <Icon spin icon={Loader2} />
        </Flexbox>
      );
    }

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
          {t('tools.lobehubSkill.connect', { defaultValue: 'Connect' })}
          <Icon icon={SquareArrowOutUpRight} size="small" />
        </Flexbox>
      );
    }

    switch (server.status) {
      case LobehubSkillStatus.CONNECTED: {
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
      case LobehubSkillStatus.CONNECTING: {
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
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const redirectUri = `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(provider)}`;
                const { authorizeUrl } = await getAuthorizeUrl(provider, { redirectUri });
                openOAuthWindow(authorizeUrl);
              } catch (error) {
                console.error('[LobehubSkill] Failed to get authorize URL:', error);
              }
            }}
          >
            {t('tools.lobehubSkill.authorize', { defaultValue: 'Authorize' })}
            <Icon icon={SquareArrowOutUpRight} size="small" />
          </Flexbox>
        );
      }
      case LobehubSkillStatus.NOT_CONNECTED: {
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
            {t('tools.lobehubSkill.connect', { defaultValue: 'Connect' })}
            <Icon icon={SquareArrowOutUpRight} size="small" />
          </Flexbox>
        );
      }
      case LobehubSkillStatus.ERROR: {
        return (
          <span style={{ color: 'red', fontSize: 12 }}>
            {t('tools.lobehubSkill.error', { defaultValue: 'Error' })}
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
        if (server?.status === LobehubSkillStatus.CONNECTED) {
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
});

export default LobehubSkillServerItem;
