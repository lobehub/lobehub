'use client';

import { KLAVIS_SERVER_TYPES, type KlavisServerType } from '@lobechat/const';
import { Avatar, Button, Flexbox, Icon, type ItemType, Segmented } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ArrowRight, PlusIcon, Store, ToyBrick } from 'lucide-react';
import Image from 'next/image';
import React, { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import KlavisServerItem from '@/features/ChatInput/ActionBar/Tools/KlavisServerItem';
import ToolItem from '@/features/ChatInput/ActionBar/Tools/ToolItem';
import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import PluginStore from '@/features/PluginStore';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  builtinToolSelectors,
  klavisStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';

import PluginTag from './PluginTag';

type TabType = 'all' | 'installed';

/**
 * Klavis 服务器图标组件
 * 对于 string 类型的 icon，使用 Image 组件渲染
 * 对于 IconType 类型的 icon，使用 Icon 组件渲染，并根据主题设置填充色
 */
const KlavisIcon = memo<Pick<KlavisServerType, 'icon' | 'label'>>(({ icon, label }) => {
  if (typeof icon === 'string') {
    return (
      <Image alt={label} height={18} src={icon} style={{ flex: 'none' }} unoptimized width={18} />
    );
  }

  // 使用主题色填充，在深色模式下自动适应
  return <Icon fill={cssVar.colorText} icon={icon} size={18} />;
});

const AgentTool = memo(() => {
  const { t } = useTranslation('setting');
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);

  // Plugin state management
  const plugins = config?.plugins || [];

  const toggleAgentPlugin = useAgentStore((s) => s.toggleAgentPlugin);
  const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const builtinList = useToolStore(builtinToolSelectors.metaList, isEqual);

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
  const filteredBuiltinList = useMemo(
    () =>
      isKlavisEnabledInEnv
        ? builtinList.filter((item) => !allKlavisTypeIdentifiers.has(item.identifier))
        : builtinList,
    [builtinList, allKlavisTypeIdentifiers, isKlavisEnabledInEnv],
  );

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

  // Handle plugin remove via Tag close
  const handleRemovePlugin =
    (pluginId: string | { enabled: boolean; identifier: string; settings: Record<string, any> }) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const identifier = typeof pluginId === 'string' ? pluginId : pluginId?.identifier;
      toggleAgentPlugin(identifier, false);
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
            checked={plugins.includes(item.identifier)}
            id={item.identifier}
            label={item.meta?.title}
            onUpdate={async () => {
              setUpdating(true);
              await toggleAgentPlugin(item.identifier);
              setUpdating(false);
            }}
          />
        ),
      })),
      // Klavis 服务器
      ...klavisServerItems,
    ],
    [filteredBuiltinList, klavisServerItems, plugins, toggleAgentPlugin],
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
              await toggleAgentPlugin(item.identifier);
              setUpdating(false);
            }}
          />
        ),
      })),
    [installedPluginList, plugins, toggleAgentPlugin],
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
      .filter((item) => plugins.includes(item.identifier))
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
              await toggleAgentPlugin(item.identifier);
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
              await toggleAgentPlugin(item.identifier);
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
  }, [filteredBuiltinList, klavisServerItems, installedPluginList, plugins, toggleAgentPlugin, t]);

  // Use effective tab for display (default to all while initializing)
  const effectiveTab = activeTab ?? 'all';
  const currentItems = effectiveTab === 'all' ? allTabItems : installedTabItems;

  // Final menu items with tab segmented control
  const menuItems: ItemType[] = useMemo(
    () => [
      {
        key: 'tabs',
        label: (
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
        ),
        type: 'group',
      },
      ...currentItems,
    ],
    [currentItems, effectiveTab, t],
  );

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

  return (
    <>
      {/* Plugin Selector and Tags */}
      <Flexbox align="center" gap={8} horizontal wrap={'wrap'}>
        {/* Second Row: Selected Plugins as Tags */}
        {plugins?.map((pluginId) => {
          return (
            <PluginTag key={pluginId} onRemove={handleRemovePlugin(pluginId)} pluginId={pluginId} />
          );
        })}
        {/* Plugin Selector Dropdown - Using Action component pattern */}

        <Suspense fallback={button}>
          <ActionDropdown
            maxHeight={500}
            maxWidth={480}
            menu={{ items: menuItems }}
            minHeight={isKlavisEnabledInEnv ? 500 : undefined}
            minWidth={320}
            placement={'bottomLeft'}
            trigger={['click']}
          >
            {button}
          </ActionDropdown>
        </Suspense>
      </Flexbox>

      {/* PluginStore Modal */}
      <PluginStore open={modalOpen} setOpen={setModalOpen} />
    </>
  );
});

export default AgentTool;
