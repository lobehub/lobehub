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

// 轮询配置
const POLL_INTERVAL_MS = 1000; // 每秒轮询一次
const POLL_TIMEOUT_MS = 15_000; // 15 秒超时

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

    // 清理所有定时器
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

    // 组件卸载时清理
    useEffect(() => {
      return () => {
        cleanup();
      };
    }, [cleanup]);

    // 当服务器状态变为 CONNECTED 时停止所有监听
    useEffect(() => {
      if (server?.status === KlavisServerStatus.CONNECTED && isWaitingAuth) {
        cleanup();
      }
    }, [server?.status, isWaitingAuth, cleanup, t]);

    /**
     * 启动降级轮询（当 window.closed 不可访问时）
     */
    const startFallbackPolling = useCallback(
      (serverName: string) => {
        // 已经在轮询了，不重复启动
        if (pollIntervalRef.current) return;

        // 每秒轮询一次
        pollIntervalRef.current = setInterval(async () => {
          try {
            await refreshKlavisServerTools(serverName);
          } catch (error) {
            console.debug('[Klavis] Polling check (expected during auth):', error);
          }
        }, POLL_INTERVAL_MS);

        // 15 秒后超时停止
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
     * 监听 OAuth 窗口关闭
     */
    const startWindowMonitor = useCallback(
      (oauthWindow: Window, serverName: string) => {
        // 每 500ms 检查窗口状态
        windowCheckIntervalRef.current = setInterval(() => {
          try {
            // 尝试访问 window.closed（可能被 COOP 阻止）
            if (oauthWindow.closed) {
              // 窗口已关闭，清理监听并检查认证状态
              if (windowCheckIntervalRef.current) {
                clearInterval(windowCheckIntervalRef.current);
                windowCheckIntervalRef.current = null;
              }
              oauthWindowRef.current = null;

              // 窗口关闭后开始轮询检查认证状态
              startFallbackPolling(serverName);
            }
          } catch {
            // COOP 阻止了访问，降级到轮询方案
            console.log('[Klavis] COOP blocked window.closed access, falling back to polling');
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
     * 打开 OAuth 窗口
     */
    const openOAuthWindow = useCallback(
      (oauthUrl: string, serverName: string) => {
        // 清理之前的状态
        cleanup();
        setIsWaitingAuth(true);

        // 打开 OAuth 窗口
        const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');
        if (oauthWindow) {
          oauthWindowRef.current = oauthWindow;
          startWindowMonitor(oauthWindow, serverName);
        } else {
          // 窗口被阻止，直接用轮询
          startFallbackPolling(serverName);
        }
      },
      [cleanup, startWindowMonitor, startFallbackPolling, t],
    );

    // Get plugin ID for this server (使用 identifier 作为 pluginId)
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
          // 安装完成后自动启用插件（使用 identifier）
          const newPluginId = newServer.identifier;
          await togglePlugin(newPluginId);

          // 如果已认证，直接刷新工具列表，跳过 OAuth
          if (newServer.isAuthenticated) {
            await refreshKlavisServerTools(newServer.identifier);
          } else if (newServer.oauthUrl) {
            // 需要 OAuth，打开 OAuth 窗口并监听关闭
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

    // 渲染右侧控件
    const renderRightControl = () => {
      // 正在连接中
      if (isConnecting) {
        return (
          <Flexbox horizontal align="center" gap={4} onClick={stopPropagation}>
            <Icon spin icon={Loader2} />
          </Flexbox>
        );
      }

      // 未连接，显示 Connect 按钮
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

      // 根据状态显示不同控件
      switch (server.status) {
        case KlavisServerStatus.CONNECTED: {
          // 正在切换状态
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
          // 正在等待认证
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
                // 点击重新打开 OAuth 窗口
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
          // 如果已连接，点击整行切换状态
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
