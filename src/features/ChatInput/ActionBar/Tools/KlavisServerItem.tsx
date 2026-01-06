import { Flexbox, Icon , Checkbox } from '@lobehub/ui';
import { Loader2, SquareArrowOutUpRight, Unplug } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { type KlavisServer, KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

// 轮询配置
const POLL_INTERVAL_MS = 1000; // 每秒轮询一次
const POLL_TIMEOUT_MS = 15_000; // 15 秒超时

interface KlavisServerItemProps {
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
  ({ identifier, label, server, serverName }) => {
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
    const removeKlavisServer = useToolStore((s) => s.removeKlavisServer);

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
            console.error('[Klavis] Failed to check auth status:', error);
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

              // 窗口关闭后立即检查一次认证状态
              refreshKlavisServerTools(serverName);
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
    const [checked, togglePlugin] = useAgentStore((s) => [
      agentSelectors.currentAgentPlugins(s).includes(pluginId),
      s.togglePlugin,
    ]);

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

    const handleDisconnect = async () => {
      if (!server) return;
      setIsToggling(true);
      // 如果当前已启用，先禁用
      if (checked) {
        await togglePlugin(pluginId);
      }
      // 删除服务器（使用 identifier）
      await removeKlavisServer(server.identifier);
      setIsToggling(false);
    };

    // 渲染右侧控件
    const renderRightControl = () => {
      // 正在连接中
      if (isConnecting) {
        return (
          <Flexbox align="center" gap={4} horizontal onClick={(e) => e.stopPropagation()}>
            <Icon icon={Loader2} spin />
          </Flexbox>
        );
      }

      // 未连接，显示 Connect 按钮
      if (!server) {
        return (
          <Flexbox
            align="center"
            gap={4}
            horizontal
            onClick={(e) => {
              e.stopPropagation();
              handleConnect();
            }}
            style={{ cursor: 'pointer', opacity: 0.65 }}
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
            return <Icon icon={Loader2} spin />;
          }
          return (
            <Flexbox align="center" gap={8} horizontal>
              <Icon
                icon={Unplug}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDisconnect();
                }}
                size="small"
                style={{ cursor: 'pointer', opacity: 0.5 }}
              />
              <Checkbox
                checked={checked}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle();
                }}
              />
            </Flexbox>
          );
        }
        case KlavisServerStatus.PENDING_AUTH: {
          // 正在等待认证
          if (isWaitingAuth) {
            return (
              <Flexbox align="center" gap={4} horizontal onClick={(e) => e.stopPropagation()}>
                <Icon icon={Loader2} spin />
              </Flexbox>
            );
          }
          return (
            <Flexbox
              align="center"
              gap={4}
              horizontal
              onClick={(e) => {
                e.stopPropagation();
                // 点击重新打开 OAuth 窗口
                if (server.oauthUrl) {
                  openOAuthWindow(server.oauthUrl, server.identifier);
                }
              }}
              style={{ cursor: 'pointer', opacity: 0.65 }}
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
        align={'center'}
        gap={24}
        horizontal
        justify={'space-between'}
        onClick={(e) => {
          e.stopPropagation();
          // 如果已连接，点击整行切换状态
          if (server?.status === KlavisServerStatus.CONNECTED) {
            handleToggle();
          }
        }}
        style={{ paddingLeft: 8 }}
      >
        <Flexbox align={'center'} gap={8} horizontal>
          {label}
        </Flexbox>
        {renderRightControl()}
      </Flexbox>
    );
  },
);

export default KlavisServerItem;
