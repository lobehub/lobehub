import { Flexbox } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { useToolStore } from '@/store/tool';

import { useStore } from '../store';

const MarketList = memo<{ id: string }>(({ id }) => {
  const [toggleAgentPlugin, hasPlugin] = useStore((s) => [s.toggleAgentPlugin, !!s.config.plugins]);
  const plugins = useStore((s) => s.config.plugins || []);

  const [useFetchPluginList, fetchPluginManifest] = useToolStore((s) => [
    s.useFetchPluginStore,
    s.installPlugin,
  ]);

  const pluginManifestLoading = useToolStore((s) => s.pluginInstallLoading, isEqual);

  useFetchPluginList();

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Switch
        loading={pluginManifestLoading[id]}
        checked={
          // 如果在加载中，说明激活了
          pluginManifestLoading[id] || !hasPlugin ? false : plugins.includes(id)
        }
        onChange={(checked) => {
          toggleAgentPlugin(id);
          if (checked) {
            fetchPluginManifest(id);
          }
        }}
      />
    </Flexbox>
  );
});

export default MarketList;
