import { Flexbox, SortableList, Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getChannelDisplayName, getChannelIcon } from './const';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};
    transition: background 0.2s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  name: css`
    font-weight: 500;
  `,
}));

interface ChannelItemProps {
  /**
   * Locks the toggle in its current state. Used to keep the last enabled channel
   * on: this list only picks & orders channels, so turning the tool itself off
   * is handled elsewhere and must not be reachable by disabling every channel.
   */
  disabled?: boolean;
  enabled: boolean;
  id: string;
  onToggle: (id: string, enabled: boolean) => void;
}

const ChannelItem = memo<ChannelItemProps>(({ id, enabled, disabled, onToggle }) => {
  const { t } = useTranslation('setting');

  return (
    <SortableList.Item
      horizontal
      align={'center'}
      className={styles.item}
      gap={8}
      id={id}
      justify={'space-between'}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <SortableList.DragHandle />
        {getChannelIcon(id)}
        <Text className={styles.name}>{getChannelDisplayName(id)}</Text>
      </Flexbox>
      <Switch
        aria-label={t(enabled ? 'settingTool.item.enabled' : 'settingTool.item.disabled')}
        checked={enabled}
        disabled={disabled}
        size={'small'}
        onChange={(checked) => onToggle(id, checked)}
      />
    </SortableList.Item>
  );
});

export default ChannelItem;
