import { Flexbox } from '@lobehub/ui';
import { Switch } from 'antd';
import { memo } from 'react';

import { useStore } from '../store';

const MarketList = memo<{ id: string }>(({ id }) => {
  const [toggleAgentPlugin, hasPlugin] = useStore((s) => [s.toggleAgentPlugin, !!s.config.plugins]);
  const plugins = useStore((s) => s.config.plugins || []);

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Switch
        checked={!hasPlugin ? false : plugins.includes(id)}
        onChange={() => {
          toggleAgentPlugin(id);
        }}
      />
    </Flexbox>
  );
});

export default MarketList;
