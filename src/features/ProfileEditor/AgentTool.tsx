'use client';

import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { type ItemType } from '@lobehub/ui';
import { Avatar, Button, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { PlusIcon, ToyBrick } from 'lucide-react';
import React, { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import KlavisServerItem from '@/features/ChatInput/ActionBar/Tools/KlavisServerItem';
import KlavisSkillIcon, {
  SKILL_ICON_SIZE,
} from '@/features/ChatInput/ActionBar/Tools/KlavisSkillIcon';
import LobehubSkillIcon from '@/features/ChatInput/ActionBar/Tools/LobehubSkillIcon';
import LobehubSkillServerItem from '@/features/ChatInput/ActionBar/Tools/LobehubSkillServerItem';
import ToolItem from '@/features/ChatInput/ActionBar/Tools/ToolItem';
import { createSkillStoreModal } from '@/features/SkillStore';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { type LobeToolMetaWithAvailability } from '@/store/tool/slices/builtin/selectors';

import PluginTag from './PluginTag';
import PopoverContent from './PopoverContent';

const WEB_BROWSING_IDENTIFIER = 'lobe-web-browsing';

type TabType = 'all' | 'installed';

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
    // When useAllMetaList is true, use installedAllMetaList to include hidden/platform-specific
    // tools but still exclude user-uninstalled tools
    const builtinList = useToolStore(
      useAllMetaList ? builtinToolSelectors.installedAllMetaList : builtinToolSelectors.metaList,
      isEqual,
    );

    // Web browsing uses searchMode instead of plugins array - use byId selector
    const isSearchEnabled = useAgentStore(
      chatConfigByIdSelectors.isEnableSearchById(effectiveAgentId),
    );

    // Klavis 相关状态
    const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
    const isKlavisEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableKlavis);

    // LobeHub Skill 相关状态
    const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
    const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

    const [updating, setUpdating] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    // Tab state for dual-column layout
    const [activeTab, setActiveTab] = useState<TabType | null>(null);
    const isInitializedRef = useRef(false);

    // Fetch plugins
    const [useFetchPluginStore, useFetchUserKlavisServers, useFetchLobehubSkillConnections] =
      useToolStore((s) => [
        s.useFetchPluginStore,
        s.useFetchUserKlavisServers,
        s.useFetchLobehubSkillConnections,
      ]);
    useFetchPluginStore();
    useFetchInstalledPlugins();
    useCheckPluginsIsInstalled(plugins);

    // 使用 SWR 加载用户的 Klavis 集成（从数据库）
    useFetchUserKlavisServers(isKlavisEnabledInEnv);

    // 使用 SWR 加载用户的 LobeHub Skill 连接
    useFetchLobehubSkillConnections(isLobehubSkillEnabled);

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
    // Only show 'installed' tab by default if more than 5 plugins are enabled
    useEffect(() => {
      if (!isInitializedRef.current && plugins.length >= 0) {
        isInitializedRef.current = true;
        setActiveTab(plugins.length > 5 ? 'installed' : 'all');
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
              icon: <KlavisSkillIcon icon={type.icon} label={type.label} size={SKILL_ICON_SIZE} />,
              key: type.identifier,
              label: (
                <KlavisServerItem
                  agentId={effectiveAgentId}
                  identifier={type.identifier}
                  label={type.label}
                  server={getServerByName(type.identifier)}
                  serverName={type.serverName}
                />
              ),
            }))
          : [],
      [isKlavisEnabledInEnv, allKlavisServers, effectiveAgentId],
    );

    // LobeHub Skill Provider 列表项
    const lobehubSkillItems = useMemo(
      () =>
        isLobehubSkillEnabled
          ? LOBEHUB_SKILL_PROVIDERS.map((provider) => ({
              icon: (
                <LobehubSkillIcon
                  icon={provider.icon}
                  label={provider.label}
                  size={SKILL_ICON_SIZE}
                />
              ),
              key: provider.id, // 使用 provider.id 作为 key，与 pluginId 保持一致
              label: (
                <LobehubSkillServerItem
                  agentId={effectiveAgentId}
                  label={provider.label}
                  provider={provider.id}
                />
              ),
            }))
          : [],
      [isLobehubSkillEnabled, allLobehubSkillServers, effectiveAgentId],
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

    // 合并 builtin 工具、LobeHub Skill Providers 和 Klavis 服务器
    const builtinItems = useMemo(
      () => [
        // 原有的 builtin 工具
        ...filteredBuiltinList.map((item) => ({
          icon: (
            <Avatar
              avatar={item.meta.avatar}
              size={SKILL_ICON_SIZE}
              style={{ marginInlineEnd: 0 }}
            />
          ),
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
        // LobeHub Skill Providers
        ...lobehubSkillItems,
        // Klavis 服务器
        ...klavisServerItems,
      ],
      [filteredBuiltinList, klavisServerItems, lobehubSkillItems, isToolEnabled, handleToggleTool],
    );

    // 区分社区插件和自定义插件
    const communityPlugins = installedPluginList.filter((item) => item.type !== 'customPlugin');
    const customPlugins = installedPluginList.filter((item) => item.type === 'customPlugin');

    // 生成插件列表项的函数
    const mapPluginToItem = useCallback(
      (item: (typeof installedPluginList)[0]) => ({
        icon: item?.avatar ? (
          <PluginAvatar
            avatar={item.avatar}
            size={SKILL_ICON_SIZE}
            style={{ marginInlineEnd: 0 }}
          />
        ) : (
          <Icon icon={ToyBrick} size={SKILL_ICON_SIZE} />
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
      }),
      [plugins, togglePlugin],
    );

    // Community 插件列表项
    const communityPluginItems = useMemo(
      () => communityPlugins.map(mapPluginToItem),
      [communityPlugins, mapPluginToItem],
    );

    // Custom 插件列表项
    const customPluginItems = useMemo(
      () => customPlugins.map(mapPluginToItem),
      [customPlugins, mapPluginToItem],
    );

    // All tab items (市场 tab)
    const allTabItems: ItemType[] = useMemo(
      () => [
        // LobeHub 分组
        ...(builtinItems.length > 0
          ? [
              {
                children: builtinItems,
                key: 'lobehub',
                label: t('skillStore.tabs.lobehub'),
                type: 'group' as const,
              },
            ]
          : []),
        // Community 分组
        ...(communityPluginItems.length > 0
          ? [
              {
                children: communityPluginItems,
                key: 'community',
                label: t('skillStore.tabs.community'),
                type: 'group' as const,
              },
            ]
          : []),
        // Custom 分组
        ...(customPluginItems.length > 0
          ? [
              {
                children: customPluginItems,
                key: 'custom',
                label: t('skillStore.tabs.custom'),
                type: 'group' as const,
              },
            ]
          : []),
      ],
      [builtinItems, communityPluginItems, customPluginItems, t],
    );

    // Installed tab items - 只显示已启用的
    const installedTabItems: ItemType[] = useMemo(() => {
      const items: ItemType[] = [];

      // 已启用的 builtin 工具
      const enabledBuiltinItems = filteredBuiltinList
        .filter((item) => isToolEnabled(item.identifier))
        .map((item) => ({
          icon: (
            <Avatar
              avatar={item.meta.avatar}
              size={SKILL_ICON_SIZE}
              style={{ marginInlineEnd: 0 }}
            />
          ),
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

      // 已连接的 LobeHub Skill Providers
      const connectedLobehubSkillItems = lobehubSkillItems.filter((item) =>
        plugins.includes(item.key as string),
      );

      // LobeHub 分组（builtin + LobeHub Skill + Klavis）
      const lobehubGroupItems = [
        ...enabledBuiltinItems,
        ...connectedLobehubSkillItems,
        ...connectedKlavisItems,
      ];

      if (lobehubGroupItems.length > 0) {
        items.push({
          children: lobehubGroupItems,
          key: 'installed-lobehub',
          label: t('skillStore.tabs.lobehub'),
          type: 'group',
        });
      }

      // 已启用的社区插件
      const enabledCommunityPlugins = communityPlugins
        .filter((item) => plugins.includes(item.identifier))
        .map((item) => ({
          icon: item?.avatar ? (
            <PluginAvatar avatar={item.avatar} size={SKILL_ICON_SIZE} />
          ) : (
            <Icon icon={ToyBrick} size={SKILL_ICON_SIZE} />
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

      if (enabledCommunityPlugins.length > 0) {
        items.push({
          children: enabledCommunityPlugins,
          key: 'installed-community',
          label: t('skillStore.tabs.community'),
          type: 'group',
        });
      }

      // 已启用的自定义插件
      const enabledCustomPlugins = customPlugins
        .filter((item) => plugins.includes(item.identifier))
        .map((item) => ({
          icon: item?.avatar ? (
            <PluginAvatar avatar={item.avatar} size={SKILL_ICON_SIZE} />
          ) : (
            <Icon icon={ToyBrick} size={SKILL_ICON_SIZE} />
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

      if (enabledCustomPlugins.length > 0) {
        items.push({
          children: enabledCustomPlugins,
          key: 'installed-custom',
          label: t('skillStore.tabs.custom'),
          type: 'group',
        });
      }

      return items;
    }, [
      filteredBuiltinList,
      klavisServerItems,
      lobehubSkillItems,
      communityPlugins,
      customPlugins,
      plugins,
      isToolEnabled,
      handleToggleTool,
      togglePlugin,
      t,
    ]);

    // Use effective tab for display (default to all while initializing)
    const effectiveTab = activeTab ?? 'all';

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
        <Flexbox horizontal align="center" gap={8} wrap={'wrap'}>
          <Suspense fallback={button}>
            {/* Plugin Selector Dropdown - Using Action component pattern */}
            <ActionDropdown
              maxWidth={400}
              minWidth={400}
              open={dropdownOpen}
              placement={'bottomLeft'}
              trigger={'click'}
              menu={{
                items: [],
                style: {
                  // let only the custom scroller scroll
                  maxHeight: 'unset',
                  overflowY: 'visible',
                },
              }}
              popupProps={{
                style: {
                  padding: 0,
                },
              }}
              popupRender={() => (
                <PopoverContent
                  activeTab={effectiveTab}
                  allTabItems={allTabItems}
                  installedTabItems={installedTabItems}
                  onClose={() => setDropdownOpen(false)}
                  onTabChange={setActiveTab}
                  onOpenStore={() => {
                    setDropdownOpen(false);
                    createSkillStoreModal();
                  }}
                />
              )}
              positionerProps={{
                collisionAvoidance: { align: 'flip', fallbackAxisSide: 'end', side: 'flip' },
                collisionBoundary:
                  typeof document === 'undefined' ? undefined : document.documentElement,
                positionMethod: 'fixed',
              }}
              onOpenChange={setDropdownOpen}
            >
              {button}
            </ActionDropdown>
          </Suspense>
          {/* Selected Plugins as Tags */}
          {allEnabledTools.map((pluginId) => {
            return (
              <PluginTag
                key={pluginId}
                pluginId={pluginId}
                showDesktopOnlyLabel={filterAvailableInWeb}
                useAllMetaList={useAllMetaList}
                onRemove={handleRemovePlugin(pluginId)}
              />
            );
          })}
        </Flexbox>
      </>
    );
  },
);

AgentTool.displayName = 'AgentTool';

export default AgentTool;
