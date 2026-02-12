'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Avatar, Button, Center, Empty, Flexbox, Form, Tag, Tooltip } from '@lobehub/ui';
import { Space, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { BlocksIcon, LucideTrash2, Store } from 'lucide-react';
import { memo, useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginTag from '@/components/Plugins/PluginTag';
import { FORM_STYLE } from '@/const/layoutTokens';
import { createSkillStoreModal } from '@/features/SkillStore';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { useStore } from '../store';
import AddPluginButton from './AddPluginButton';
import LoadingList from './LoadingList';
import LocalPluginItem from './LocalPluginItem';
import PluginAction from './PluginAction';

const AgentPlugin = memo(() => {
  const { t } = useTranslation('setting');

  const navigate = useNavigate();

  const handleOpenStore = useCallback(() => {
    createSkillStoreModal();
  }, []);

  const [userEnabledPlugins, toggleAgentPlugin] = useStore((s) => [
    s.config.plugins || [],
    s.toggleAgentPlugin,
  ]);

  const { showMarket } = useServerConfigStore(featureFlagsSelectors);
  const installedPlugins = useToolStore(toolSelectors.metaList, isEqual);

  const { isLoading } = useFetchInstalledPlugins();

  const isEmpty = installedPlugins.length === 0 && userEnabledPlugins.length === 0;

  //  =========== Plugin List =========== //

  const list = installedPlugins.map(({ identifier, type, meta, author }) => {
    const isCustomPlugin = type === 'customPlugin';

    return {
      avatar: <PluginAvatar avatar={pluginHelpers.getPluginAvatar(meta)} size={40} />,
      children: isCustomPlugin ? (
        <LocalPluginItem id={identifier} />
      ) : (
        <PluginAction identifier={identifier} />
      ),
      desc: pluginHelpers.getPluginDesc(meta),
      label: (
        <Flexbox horizontal align={'center'} gap={8}>
          {pluginHelpers.getPluginTitle(meta)}
          <PluginTag author={author} type={type} />
        </Flexbox>
      ),
      layout: 'horizontal',
      minWidth: undefined,
    };
  });

  //  =========== Deprecated Plugin List =========== //

  // 检查出不在 installedPlugins 中的插件
  const deprecatedList = userEnabledPlugins
    .filter((pluginId) => !installedPlugins.some((p) => p.identifier === pluginId))
    .map((id) => ({
      avatar: <Avatar avatar={'♻️'} shape={'square'} size={40} />,
      children: (
        <Switch
          checked={true}
          onChange={() => {
            toggleAgentPlugin(id);
          }}
        />
      ),
      label: (
        <Flexbox horizontal align={'center'} gap={8}>
          {id}
          <Tag color={'red'}>{t('plugin.installStatus.deprecated')}</Tag>
        </Flexbox>
      ),
      layout: 'horizontal',
      minWidth: undefined,
      tag: id,
    }));

  const hasDeprecated = deprecatedList.length > 0;

  const loadingSkeleton = LoadingList();

  const extra = (
    <Space.Compact style={{ width: 'auto' }}>
      <AddPluginButton />
      {hasDeprecated ? (
        <Tooltip title={t('plugin.clearDeprecated')}>
          <Button
            icon={LucideTrash2}
            size={'small'}
            onClick={(e) => {
              e.stopPropagation();
              for (const i of deprecatedList) {
                toggleAgentPlugin(i.tag as string);
              }
            }}
          />
        </Tooltip>
      ) : null}
      {showMarket ? (
        <Tooltip title={t('plugin.store')}>
          <Button
            icon={Store}
            size={'small'}
            onClick={(e) => {
              e.stopPropagation();
              handleOpenStore();
            }}
          />
        </Tooltip>
      ) : null}
    </Space.Compact>
  );

  const empty = (
    <Center padding={40}>
      <Empty
        descriptionProps={{ fontSize: 14 }}
        icon={BlocksIcon}
        style={{ maxWidth: 400 }}
        description={
          <Trans i18nKey={'plugin.empty'} ns={'setting'}>
            暂无安装插件，
            <Link
              to={'/community/mcp'}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleOpenStore();
                navigate('/community/mcp');
              }}
            >
              前往插件市场
            </Link>
            安装
          </Trans>
        }
      />
    </Center>
  );

  const plugin: FormGroupItemType = {
    children: isLoading
      ? loadingSkeleton
      : isEmpty
        ? showMarket
          ? empty
          : []
        : [...deprecatedList, ...list],
    extra,
    title: t('settingPlugin.title'),
  };

  return <Form items={[plugin]} itemsType={'group'} variant={'borderless'} {...FORM_STYLE} />;
});

export default AgentPlugin;
