import { Center, Flexbox, SortableList, Tooltip } from '@lobehub/ui';
import { Switch, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getChannelDisplayName, getChannelIcon } from './const';

const ICON_SIZE = 24;

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    flex: none;
    width: ${ICON_SIZE}px;
    height: ${ICON_SIZE}px;
  `,
  inactive: css`
    opacity: 0.45;
  `,
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
  rank: css`
    min-width: 16px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextQuaternary};
    text-align: end;
  `,
}));

interface ChannelItemProps {
  enabled: boolean;
  id: string;
  /**
   * Locks the toggle in its current state. Used to keep the last enabled channel
   * on: this list only picks & orders channels, so turning the tool itself off
   * is handled elsewhere and must not be reachable by disabling every channel.
   */
  locked?: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  /** 1-based priority among enabled channels; omitted for disabled channels. */
  rank?: number;
}

const ChannelItem = memo<ChannelItemProps>(({ id, enabled, locked, rank, onToggle }) => {
  const { t } = useTranslation('setting');

  const toggle = (
    <Switch
      aria-label={t(enabled ? 'settingTool.item.enabled' : 'settingTool.item.disabled')}
      checked={enabled}
      disabled={locked}
      size={'small'}
      onChange={(checked) => onToggle(id, checked)}
    />
  );

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
        <span className={styles.rank}>{rank ?? ''}</span>
        <Flexbox horizontal align={'center'} className={cx(!enabled && styles.inactive)} gap={10}>
          <Center className={styles.icon}>{getChannelIcon(id, ICON_SIZE)}</Center>
          <Text className={styles.name}>{getChannelDisplayName(id)}</Text>
        </Flexbox>
      </Flexbox>
      {locked ? (
        // A disabled switch swallows pointer events, so the tooltip needs a wrapper.
        <Tooltip title={t('settingTool.item.locked')}>
          <span>{toggle}</span>
        </Tooltip>
      ) : (
        toggle
      )}
    </SortableList.Item>
  );
});

export default ChannelItem;
