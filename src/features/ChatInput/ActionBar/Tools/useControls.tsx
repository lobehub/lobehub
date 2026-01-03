import { KLAVIS_SERVER_TYPES, type KlavisServerType } from '@lobechat/const';
import { Avatar, Flexbox, Icon, Image, type ItemType } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ArrowRight, Store, ToyBrick } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  builtinToolSelectors,
  klavisStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import KlavisServerItem from './KlavisServerItem';
import ToolItem from './ToolItem';

/**
 * Klavis 服务器图标组件
 * 对于 string 类型的 icon，使用 Image 组件渲染
 * 对于 IconType 类型的 icon，使用 Icon 组件渲染，并根据主题设置填充色
 */
const KlavisIcon = memo<Pick<KlavisServerType, 'icon' | 'label'>>(({ icon, label }) => {
  if (typeof icon === 'string') {
    return <Image alt={label} height={18} src={icon} style={{ flex: 'none' }} width={18} />;
  }

  // 使用主题色填充，在深色模式下自动适应
  return <Icon fill={cssVar.colorText} icon={icon} size={18} />;
});

KlavisIcon.displayName = 'KlavisIcon';

export const useControls = ({
  setModalOpen,
  setUpdating,
}: {
  setModalOpen: (open: boolean) => void;
  setUpdating: (updating: boolean) => void;
}) => {
  const { t } = useTranslation('setting');
  const agentId = useAgentId();
  const list = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const [checked, togglePlugin] = useAgentStore((s) => [
    agentByIdSelectors.getAgentPluginsById(agentId)(s),
    s.togglePlugin,
  ]);
  const builtinList = useToolStore(builtinToolSelectors.metaList, isEqual);
  const enablePluginCount = useAgentStore(
    (s) =>
      agentByIdSelectors
        .getAgentPluginsById(agentId)(s)
        .filter((i) => !builtinList.some((b) => b.identifier === i)).length,
  );
  const plugins = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));

  // Klavis 相关状态
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const isKlavisEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableKlavis);

  const [useFetchPluginStore, useFetchUserKlavisServers] = useToolStore((s) => [
    s.useFetchPluginStore,
    s.useFetchUserKlavisServers,
  ]);

  useFetchPluginStore();
  useFetchInstalledPlugins();
  useCheckPluginsIsInstalled(plugins);

  // 使用 SWR 加载用户的 Klavis 集成（从数据库）
  useFetchUserKlavisServers(isKlavisEnabledInEnv);

  // 根据 identifier 获取已连接的服务器
  const getServerByName = (identifier: string) => {
    return allKlavisServers.find((server) => server.identifier === identifier);
  };

  // 获取所有 Klavis 服务器类型的 identifier 集合（用于过滤 builtinList）
  // 这里使用 KLAVIS_SERVER_TYPES 而不是已连接的服务器，因为我们要过滤掉所有可能的 Klavis 类型
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

  // 合并 builtin 工具和 Klavis 服务器
  const builtinItems = useMemo(
    () => [
      // 原有的 builtin 工具
      ...filteredBuiltinList.map((item) => ({
        icon: (
          <Avatar avatar={item.meta.avatar} shape={'square'} size={20} style={{ flex: 'none' }} />
        ),
        key: item.identifier,
        label: (
          <ToolItem
            checked={checked.includes(item.identifier)}
            id={item.identifier}
            label={item.meta?.title}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(item.identifier);
              setUpdating(false);
            }}
          />
        ),
      })),
      // Klavis 服务器
      ...klavisServerItems,
    ],
    [filteredBuiltinList, klavisServerItems, checked, togglePlugin, setUpdating],
  );

  // 市场 tab 的 items
  const marketItems: ItemType[] = [
    {
      children: builtinItems,
      key: 'builtins',
      label: t('tools.builtins.groupName'),
      type: 'group',
    },
    {
      children: list.map((item) => ({
        icon: item?.avatar ? (
          <PluginAvatar avatar={item.avatar} size={20} />
        ) : (
          <Icon icon={ToyBrick} size={20} />
        ),
        key: item.identifier,
        label: (
          <ToolItem
            checked={checked.includes(item.identifier)}
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
  ];

  // 已安装 tab 的 items - 只显示已安装的插件
  const installedPluginItems: ItemType[] = useMemo(() => {
    const installedItems: ItemType[] = [];

    // 已安装的 builtin 工具
    const enabledBuiltinItems = filteredBuiltinList
      .filter((item) => checked.includes(item.identifier))
      .map((item) => ({
        icon: (
          <Avatar avatar={item.meta.avatar} shape={'square'} size={20} style={{ flex: 'none' }} />
        ),
        key: item.identifier,
        label: (
          <ToolItem
            checked={true}
            id={item.identifier}
            label={item.meta?.title}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(item.identifier);
              setUpdating(false);
            }}
          />
        ),
      }));

    // 已连接的 Klavis 服务器（放在 builtin 里面）
    const connectedKlavisItems = klavisServerItems.filter((item) =>
      checked.includes(item.key as string),
    );

    // 合并 builtin 和 Klavis
    const allBuiltinItems = [...enabledBuiltinItems, ...connectedKlavisItems];

    if (allBuiltinItems.length > 0) {
      installedItems.push({
        children: allBuiltinItems,
        key: 'installed-builtins',
        label: t('tools.builtins.groupName'),
        type: 'group',
      });
    }

    // 已安装的插件
    const installedPlugins = list
      .filter((item) => checked.includes(item.identifier))
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
      installedItems.push({
        children: installedPlugins,
        key: 'installed-plugins',
        label: t('tools.plugins.groupName'),
        type: 'group',
      });
    }

    return installedItems;
  }, [filteredBuiltinList, list, klavisServerItems, checked, togglePlugin, setUpdating, t]);

  return { installedPluginItems, marketItems };
};
