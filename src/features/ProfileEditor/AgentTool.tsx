'use client';

import { KLAVIS_SERVER_TYPES, type KlavisServerType } from '@lobechat/const';
import { Avatar, Button, Flexbox, Icon, type ItemType, Segmented } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ArrowRight, PlusIcon, Store, ToyBrick } from 'lucide-react';
import React, { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import KlavisServerItem from '@/features/ChatInput/ActionBar/Tools/KlavisServerItem';
import ToolItem from '@/features/ChatInput/ActionBar/Tools/ToolItem';
import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import PluginStore from '@/features/PluginStore';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  builtinToolSelectors,
  klavisStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { type LobeToolMetaWithAvailability } from '@/store/tool/slices/builtin/selectors';

import PluginTag from './PluginTag';

const WEB_BROWSING_IDENTIFIER = 'lobe-web-browsing';

type TabType = 'all' | 'installed';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  dropdown: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};

    .${prefixCls}-dropdown-menu {
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
  `,
  header: css`
    padding: ${cssVar.paddingXS};
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: transparent;
  `,
  icon: css`
    flex: none;
    width: 18px;
    height: 18px;
    margin-inline-end: ${cssVar.marginXS};
  `,
  scroller: css`
    overflow: hidden auto;
  `,
}));

/**
 * Klavis 服务器图标组件
 * 对于 string 类型的 icon，使用 Image 组件渲染
 * 对于 IconType 类型的 icon，使用 Icon 组件渲染，并根据主题设置填充色
 */
const KlavisIcon = memo<Pick<KlavisServerType, 'icon' | 'label'>>(({ icon, label }) => {
  if (typeof icon === 'string') {
    return <img alt={label} className={styles.icon} height={18} src={icon} width={18} />;
  }

  // 使用主题色填充，在深色模式下自动适应
  return <Icon className={styles.icon} fill={cssVar.colorText} icon={icon} size={18} />;
});

export interface AgentToolProps {
  /**
   * Optional agent ID to use instead of currentAgentConfig
   * Used in group profile to specify which member's plugins to display
   */
  agentId?: string;
  /**
   * Whether to filter tools by availableInWeb property
   * @default false
   */
  filterAvailableInWeb?: boolean;
  /**
   * Whether to show web browsing toggle functionality
   * @default false
   */
  showWebBrowsing?: boolean;
  /**
   * Whether to use allMetaList (includes hidden tools) or metaList
   * @default false
   */
  useAllMetaList?: boolean;
}

const AgentTool = memo<AgentToolProps>(
  ({ agentId, showWebBrowsing = false, filterAvailableInWeb = false, useAllMetaList = false }) => {
    const { t } = useTranslation('setting');
    const activeAgentId = useAgentStore((s) => s.activeAgentId);
    const effectiveAgentId = agentId || activeAgentId || '';
    const config = useAgentStore(agentSelectors.getAgentConfigById(effectiveAgentId), isEqual);

    // Plugin state management
    const plugins = config?.plugins || [];

    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
    const updateAgentChatConfigById = useAgentStore((s) => s.updateAgentChatConfigById);
    const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

    // Use appropriate builtin list based on prop
    const builtinList = useToolStore(
      useAllMetaList ? builtinToolSelectors.allMetaList : builtinToolSelectors.metaList,
      isEqual,
    );

    // Web browsing uses searchMode instead of plugins array - use byId selector
    const isSearchEnabled = useAgentStore(chatConfigByIdSelectors.isEnableSearchById(effectiveAgentId));

    // Klavis 相关状态
    const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
    const isKlavisEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableKlavis);

    // Plugin store modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [updating, setUpdating] = useState(false);

    // Tab state for dual-column layout
    const [activeTab, setActiveTab] = useState<TabType | null>(null);
    const isInitializedRef = useRef(false);

    // Fetch plugins
    const [useFetchPluginStore, useFetchUserKlavisServers] = useToolStore((s) => [
      s.useFetchPluginStore,
      s.useFetchUserKlavisServers,
    ]);
    useFetchPluginStore();
    useFetchInstalledPlugins();
    useCheckPluginsIsInstalled(plugins);

    // 使用 SWR 加载用户的 Klavis 集成（从数据库）
    useFetchUserKlavisServers(isKlavisEnabledInEnv);

    // Toggle web browsing via searchMode - use byId action
    const toggleWebBrowsing = useCallback(async () => {
      if (!effectiveAgentId) return;
      const nextMode = isSearchEnabled ? 'off' : 'auto';
      await updateAgentChatConfigById(effectiveAgentId, { searchMode: nextMode });
    }, [isSearchEnabled, updateAgentChatConfigById, effectiveAgentId]);

    // Toggle a plugin - use byId action
    const togglePlugin = useCallback(
      async (pluginId: string, state?: boolean) => {
        if (!effectiveAgentId) return;
        const currentPlugins = plugins;
        const hasPlugin = currentPlugins.includes(pluginId);
        const shouldEnable = state !== undefined ? state : !hasPlugin;

        let newPlugins: string[];
        if (shouldEnable && !hasPlugin) {
          newPlugins = [...currentPlugins, pluginId];
        } else if (!shouldEnable && hasPlugin) {
          newPlugins = currentPlugins.filter((id) => id !== pluginId);
        } else {
          return;
        }

        await updateAgentConfigById(effectiveAgentId, { plugins: newPlugins });
      },
      [effectiveAgentId, plugins, updateAgentConfigById],
    );

    // Check if a tool is enabled (handles web browsing specially)
    const isToolEnabled = useCallback(
      (identifier: string) => {
        if (showWebBrowsing && identifier === WEB_BROWSING_IDENTIFIER) {
          return isSearchEnabled;
        }
        return plugins.includes(identifier);
      },
      [plugins, isSearchEnabled, showWebBrowsing],
    );

    // Toggle a tool (handles web browsing specially)
    const handleToggleTool = useCallback(
      async (identifier: string) => {
        if (showWebBrowsing && identifier === WEB_BROWSING_IDENTIFIER) {
          await toggleWebBrowsing();
        } else {
          await togglePlugin(identifier);
        }
      },
      [toggleWebBrowsing, togglePlugin, showWebBrowsing],
    );

    // Set default tab based on installed plugins (only on first load)
    useEffect(() => {
      if (!isInitializedRef.current && plugins.length >= 0) {
        isInitializedRef.current = true;
        setActiveTab(plugins.length > 0 ? 'installed' : 'all');
      }
    }, [plugins.length]);

    // 根据 identifier 获取已连接的服务器
    const getServerByName = (identifier: string) => {
      return allKlavisServers.find((server) => server.identifier === identifier);
    };

    // 获取所有 Klavis 服务器类型的 identifier 集合（用于过滤 builtinList）
    const allKlavisTypeIdentifiers = useMemo(
      () => new Set(KLAVIS_SERVER_TYPES.map((type) => type.identifier)),
      [],
    );

    // 过滤掉 builtinList 中的 klavis 工具（它们会单独显示在 Klavis 区域）
    // 根据配置，可选地过滤掉 availableInWeb: false 的工具（如 LocalSystem 仅桌面版可用）
    const filteredBuiltinList = useMemo(() => {
      // Cast to LobeToolMetaWithAvailability for type safety when filterAvailableInWeb is used
      type ListType = typeof builtinList;
      let list: ListType = builtinList;

      // Filter by availableInWeb if requested (only makes sense when using allMetaList)
      if (filterAvailableInWeb && useAllMetaList) {
        list = (list as LobeToolMetaWithAvailability[]).filter(
          (item) => item.availableInWeb,
        ) as ListType;
      }

      // Filter out Klavis tools if Klavis is enabled
      if (isKlavisEnabledInEnv) {
        list = list.filter((item) => !allKlavisTypeIdentifiers.has(item.identifier));
      }

      return list;
    }, [
      builtinList,
      allKlavisTypeIdentifiers,
      isKlavisEnabledInEnv,
      filterAvailableInWeb,
      useAllMetaList,
    ]);

    // Klavis 服务器列表项
    const klavisServerItems = useMemo(
      () =>
        isKlavisEnabledInEnv
          ? KLAVIS_SERVER_TYPES.map((type) => ({
              icon: <KlavisIcon icon={type.icon} label={type.label} />,
              key: type.identifier,
              label: (
                <KlavisServerItem
                  identifier={type.identifier}
                  label={type.label}
                  server={getServerByName(type.identifier)}
                  serverName={type.serverName}
                />
              ),
            }))
          : [],
      [isKlavisEnabledInEnv, allKlavisServers],
    );

    // Handle plugin remove via Tag close - use byId actions
    const handleRemovePlugin =
      (
        pluginId: string | { enabled: boolean; identifier: string; settings: Record<string, any> },
      ) =>
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const identifier = typeof pluginId === 'string' ? pluginId : pluginId?.identifier;
        if (showWebBrowsing && identifier === WEB_BROWSING_IDENTIFIER) {
          if (!effectiveAgentId) return;
          await updateAgentChatConfigById(effectiveAgentId, { searchMode: 'off' });
        } else {
          await togglePlugin(identifier, false);
        }
      };

    // Build dropdown menu items (adapted from useControls)
    const enablePluginCount = plugins.filter(
      (id) => !builtinList.some((b) => b.identifier === id),
    ).length;

    // 合并 builtin 工具和 Klavis 服务器
    const builtinItems = useMemo(
      () => [
        // 原有的 builtin 工具
        ...filteredBuiltinList.map((item) => ({
          icon: <Avatar avatar={item.meta.avatar} size={20} style={{ flex: 'none' }} />,
          key: item.identifier,
          label: (
            <ToolItem
              checked={isToolEnabled(item.identifier)}
              id={item.identifier}
              label={item.meta?.title}
              onUpdate={async () => {
                setUpdating(true);
                await handleToggleTool(item.identifier);
                setUpdating(false);
              }}
            />
          ),
        })),
        // Klavis 服务器
        ...klavisServerItems,
      ],
      [filteredBuiltinList, klavisServerItems, isToolEnabled, handleToggleTool],
    );

    // Plugin items for dropdown
    const pluginItems = useMemo(
      () =>
        installedPluginList.map((item) => ({
          icon: item?.avatar ? (
            <PluginAvatar avatar={item.avatar} size={20} />
          ) : (
            <Icon icon={ToyBrick} size={20} />
          ),
          key: item.identifier,
          label: (
            <ToolItem
              checked={plugins.includes(item.identifier)}
              id={item.identifier}
              label={item.title}
              onUpdate={async () => {
                setUpdating(true);
                await togglePlugin(item.identifier);
                setUpdating(false);
              }}
            />
          ),
        })),
      [installedPluginList, plugins, togglePlugin],
    );

    // All tab items (市场 tab)
    const allTabItems: ItemType[] = useMemo(
      () => [
        {
          children: builtinItems,
          key: 'builtins',
          label: t('tools.builtins.groupName'),
          type: 'group',
        },
        {
          children: pluginItems,
          key: 'plugins',
          label: (
            <Flexbox align={'center'} gap={40} horizontal justify={'space-between'}>
              {t('tools.plugins.groupName')}
              {enablePluginCount === 0 ? null : (
                <div style={{ fontSize: 12, marginInlineEnd: 4 }}>
                  {t('tools.plugins.enabled', { num: enablePluginCount })}
                </div>
              )}
            </Flexbox>
          ),
          type: 'group',
        },
        {
          type: 'divider',
        },
        {
          extra: <Icon icon={ArrowRight} />,
          icon: Store,
          key: 'plugin-store',
          label: t('tools.plugins.store'),
          onClick: () => {
            setModalOpen(true);
          },
        },
      ],
      [builtinItems, pluginItems, enablePluginCount, t],
    );

    // Installed tab items - 只显示已启用的
    const installedTabItems: ItemType[] = useMemo(() => {
      const items: ItemType[] = [];

      // 已启用的 builtin 工具
      const enabledBuiltinItems = filteredBuiltinList
        .filter((item) => isToolEnabled(item.identifier))
        .map((item) => ({
          icon: <Avatar avatar={item.meta.avatar} size={20} style={{ flex: 'none' }} />,
          key: item.identifier,
          label: (
            <ToolItem
              checked={true}
              id={item.identifier}
              label={item.meta?.title}
              onUpdate={async () => {
                setUpdating(true);
                await handleToggleTool(item.identifier);
                setUpdating(false);
              }}
            />
          ),
        }));

      // 已连接且已启用的 Klavis 服务器
      const connectedKlavisItems = klavisServerItems.filter((item) =>
        plugins.includes(item.key as string),
      );

      // 合并 builtin 和 Klavis
      const allBuiltinItems = [...enabledBuiltinItems, ...connectedKlavisItems];

      if (allBuiltinItems.length > 0) {
        items.push({
          children: allBuiltinItems,
          key: 'installed-builtins',
          label: t('tools.builtins.groupName'),
          type: 'group',
        });
      }

      // 已启用的插件
      const installedPlugins = installedPluginList
        .filter((item) => plugins.includes(item.identifier))
        .map((item) => ({
          icon: item?.avatar ? (
            <PluginAvatar avatar={item.avatar} size={20} />
          ) : (
            <Icon icon={ToyBrick} size={20} />
          ),
          key: item.identifier,
          label: (
            <ToolItem
              checked={true}
              id={item.identifier}
              label={item.title}
              onUpdate={async () => {
                setUpdating(true);
                await togglePlugin(item.identifier);
                setUpdating(false);
              }}
            />
          ),
        }));

      if (installedPlugins.length > 0) {
        items.push({
          children: installedPlugins,
          key: 'installed-plugins',
          label: t('tools.plugins.groupName'),
          type: 'group',
        });
      }

      return items;
    }, [
      filteredBuiltinList,
      klavisServerItems,
      installedPluginList,
      plugins,
      isToolEnabled,
      handleToggleTool,
      togglePlugin,
      t,
    ]);

    // Use effective tab for display (default to all while initializing)
    const effectiveTab = activeTab ?? 'all';
    const currentItems = effectiveTab === 'all' ? allTabItems : installedTabItems;

    const button = (
      <Button
        icon={PlusIcon}
        loading={updating}
        size={'small'}
        style={{ color: cssVar.colorTextSecondary }}
        type={'text'}
      >
        {t('tools.add', { defaultValue: 'Add' })}
      </Button>
    );

    // Combine plugins and web browsing for display
    const allEnabledTools = useMemo(() => {
      const tools = [...plugins];
      // Add web browsing if enabled (it's not in plugins array)
      if (showWebBrowsing && isSearchEnabled && !tools.includes(WEB_BROWSING_IDENTIFIER)) {
        tools.unshift(WEB_BROWSING_IDENTIFIER);
      }
      return tools;
    }, [plugins, isSearchEnabled, showWebBrowsing]);

    return (
      <>
        {/* Plugin Selector and Tags */}
        <Flexbox align="center" gap={8} horizontal wrap={'wrap'}>
          {/* Second Row: Selected Plugins as Tags */}
          {allEnabledTools.map((pluginId) => {
            return (
              <PluginTag
                key={pluginId}
                onRemove={handleRemovePlugin(pluginId)}
                pluginId={pluginId}
                showDesktopOnlyLabel={filterAvailableInWeb}
                useAllMetaList={useAllMetaList}
              />
            );
          })}
          {/* Plugin Selector Dropdown - Using Action component pattern */}

          <Suspense fallback={button}>
            <ActionDropdown
              maxHeight={500}
              maxWidth={400}
              menu={{
                items: currentItems,
                style: {
                  // let only the custom scroller scroll
                  maxHeight: 'unset',
                  overflowY: 'visible',
                },
              }}
              minHeight={isKlavisEnabledInEnv ? 500 : undefined}
              minWidth={400}
              placement={'bottomLeft'}
              popupRender={(menu) => (
                <div className={styles.dropdown}>
                  {/* stopPropagation prevents dropdown's onClick from calling preventDefault on Segmented */}
                  <div className={styles.header} onClick={(e) => e.stopPropagation()}>
                    <Segmented
                      block
                      onChange={(v) => setActiveTab(v as TabType)}
                      options={[
                        {
                          label: t('tools.tabs.all', { defaultValue: 'All' }),
                          value: 'all',
                        },
                        {
                          label: t('tools.tabs.installed', { defaultValue: 'Installed' }),
                          value: 'installed',
                        },
                      ]}
                      size="small"
                      value={effectiveTab}
                    />
                  </div>
                  <div
                    className={styles.scroller}
                    style={{
                      maxHeight: 500,
                      minHeight: isKlavisEnabledInEnv ? 500 : undefined,
                    }}
                  >
                    {menu}
                  </div>
                </div>
              )}
              trigger={['click']}
            >
              {button}
            </ActionDropdown>
          </Suspense>
        </Flexbox>

        {/* PluginStore Modal - rendered outside Flexbox to avoid event interference */}
        {modalOpen && <PluginStore open={modalOpen} setOpen={setModalOpen} />}
      </>
    );
  },
);

AgentTool.displayName = 'AgentTool';

export default AgentTool;
