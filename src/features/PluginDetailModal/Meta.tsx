import { Block, Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import PluginAvatar from '@/features/PluginAvatar';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const Meta = memo<{
  id: string;
}>(({ id }) => {
  const pluginMeta = useToolStore(pluginSelectors.getPluginMetaById(id), isEqual);

  return (
    <Block horizontal gap={16} padding={16} variant={'outlined'}>
      <PluginAvatar identifier={id} size={40} />
      <Flexbox gap={2}>
        <div>{pluginHelpers.getPluginTitle(pluginMeta)}</div>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {pluginHelpers.getPluginDesc(pluginMeta)}
        </Text>
      </Flexbox>
    </Block>
  );
});

export default Meta;
