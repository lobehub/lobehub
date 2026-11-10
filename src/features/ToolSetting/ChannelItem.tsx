import { Center, Flexbox, SortableList, Switch, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getChannelDisplayName, getChannelIcon } from './const';

const ICON_SIZE = 24;

const styles = stylex.create({
  icon: { flex: 'none', width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px` },
  inactive: { opacity: 0.45 },
  item: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    transition: 'background 0.2s ease-in-out',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  name: { fontWeight: 500 },
  rank: {
    minWidth: '16px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextQuaternary,
    textAlign: 'end',
  },
});

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
      className={stylex.props(styles.item).className}
      gap={8}
      id={id}
      justify={'space-between'}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <SortableList.DragHandle />
        <span {...stylex.props(styles.rank)}>{rank ?? ''}</span>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(!enabled && styles.inactive).className}
          gap={10}
        >
          <Center className={stylex.props(styles.icon).className}>
            {getChannelIcon(id, ICON_SIZE)}
          </Center>
          <Text className={stylex.props(styles.name).className}>{getChannelDisplayName(id)}</Text>
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
