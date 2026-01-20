'use client';

import { Avatar, Button, Empty, Form, type FormGroupItemType, Tag, Tooltip } from '@lobehub/ui';
import { Center, Flexbox } from '@lobehub/ui';
import { Space, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { LucideTrash2, Plug2, Store } from 'lucide-react';
import { memo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginTag from '@/components/Plugins/PluginTag';
import { FORM_STYLE } from '@/const/layoutTokens';
import SkillStore from '@/features/SkillStore';
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

  const [showStore, setShowStore] = useState(false);

  const navigate = useNavigate();

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
        <Flexbox align={'center'} gap={8} horizontal>
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
        <Flexbox align={'center'} gap={8} horizontal>
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
            onClick={(e) => {
              e.stopPropagation();
              for (const i of deprecatedList) {
                toggleAgentPlugin(i.tag as string);
              }
            }}
            size={'small'}
          />
        </Tooltip>
      ) : null}
      {showMarket ? (
        <Tooltip title={t('plugin.store')}>
          <Button
            icon={Store}
            onClick={(e) => {
              e.stopPropagation();
              setShowStore(true);
            }}
            size={'small'}
          />
        </Tooltip>
      ) : null}
    </Space.Compact>
  );

  const empty = (
    <Center padding={40}>
      <Empty
        description={
          <Trans i18nKey={'plugin.empty'} ns={'setting'}>
            暂无安装插件，
            <Link
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setShowStore(true);
                navigate('/community/mcp');
              }}
              to={'/community/mcp'}
            >
              前往插件市场
            </Link>
            安装
          </Trans>
        }
        descriptionProps={{ fontSize: 14 }}
        icon={Plug2}
        style={{ maxWidth: 400 }}
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

  return (
    <>
      <SkillStore open={showStore} setOpen={setShowStore} />
      <Form items={[plugin]} itemsType={'group'} variant={'borderless'} {...FORM_STYLE} />
    </>
  );
});

export default AgentPlugin;
