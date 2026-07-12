import { Block, Empty, Flexbox, SortableList, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ChannelItem from './ChannelItem';
import { type ChannelKey, type ChannelRow, useChannelRows } from './useChannelRows';

interface ChannelSectionProps {
  availableIds: string[];
  channelKey: ChannelKey;
  desc: string;
  title: string;
}

const ChannelSection = memo<ChannelSectionProps>(({ channelKey, availableIds, title, desc }) => {
  const { t } = useTranslation('setting');
  const { rows, toggle, reorder } = useChannelRows(channelKey, availableIds);

  // Keep at least one channel enabled: once a single channel is left on, lock
  // its switch so users can't disable the whole section from here.
  const enabledCount = rows.filter((row) => row.enabled).length;

  return (
    <Flexbox gap={8}>
      <Text strong fontSize={16}>
        {title}
      </Text>
      <Text fontSize={13} type={'secondary'}>
        {desc}
      </Text>
      <Block padding={4} style={{ marginBlockStart: 8 }} variant={'outlined'}>
        {rows.length === 0 ? (
          <Empty description={t('settingTool.empty')} />
        ) : (
          <SortableList
            items={rows}
            renderItem={(item: ChannelRow) => (
              <ChannelItem
                disabled={item.enabled && enabledCount <= 1}
                enabled={item.enabled}
                id={item.id}
                onToggle={toggle}
              />
            )}
            onChange={reorder}
          />
        )}
      </Block>
    </Flexbox>
  );
});

export default ChannelSection;
