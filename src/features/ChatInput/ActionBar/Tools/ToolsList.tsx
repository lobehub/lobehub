import type { ItemType } from '@lobehub/ui';
import { Divider, Flexbox, Icon, Popover, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { Fragment, isValidElement, memo } from 'react';

import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

import { useDetailPopoverState } from '../components/useDetailPopoverState';
import { useScrollSignal } from './ScrollSignalContext';

const styles = stylex.create({
  groupLabel: { paddingBlockStart: '10px', paddingBlockEnd: '4px', paddingInline: '10px' },
  item: {
    cursor: 'pointer',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    minHeight: sidebarRow.controlHeight,
    paddingBlock: '4px',
    paddingInline: '10px',
    borderRadius: sidebarRow.radius,
    fontSize: sidebarRow.textFontSize,
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  itemContent: { flex: '1', minWidth: '0' },
  itemIcon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: sidebarRow.iconBox,
    height: sidebarRow.iconBox,
  },
});

/**
 * Class names for callers outside this file (the profile editor popover reuses the row look).
 */
export const toolsListStyles = {
  item: stylex.props(styles.item).className,
  itemContent: stylex.props(styles.itemContent).className,
  itemIcon: stylex.props(styles.itemIcon).className,
};

interface ToolItemData {
  children?: ToolItemData[];
  extra?: ReactNode;
  icon?: ReactNode;
  key?: string;
  label?: ReactNode;
  onClick?: () => void;
  /**
   * Optional rich content shown in a hover popover for this row.
   * When set, the row is wrapped with a Popover triggered on hover, similar
   * to the model selector's detail popover.
   */
  popoverContent?: ReactNode;
  type?: 'group' | 'divider';
}

interface ToolsListProps {
  detailPlacement?: 'leftTop' | 'rightTop';
  detailPopoverDisabled?: boolean;
  items: ItemType[];
}

const DividerItem = memo<{ index: number }>(({ index }) => (
  <Divider key={`divider-${index}`} style={{ margin: '4px 0' }} />
));

const RegularItem = memo<{
  detailPlacement?: 'leftTop' | 'rightTop';
  detailPopoverDisabled?: boolean;
  index: number;
  item: ToolItemData;
}>(({ detailPlacement = 'rightTop', detailPopoverDisabled, item, index }) => {
  const { close, onOpenChange, open } = useDetailPopoverState(detailPopoverDisabled);
  const { iconSize } = useDensityTokens();

  // Close hover popover whenever the surrounding list scrolls — avoids the
  // detail panel hovering in mid-air after its anchor row has moved away.
  useScrollSignal(close);

  const iconNode = item.icon ? (
    isValidElement(item.icon) ? (
      item.icon
    ) : (
      <Icon icon={item.icon as any} size={iconSize} />
    )
  ) : null;

  const row = (
    <div
      {...stylex.props(styles.item)}
      key={item.key || `item-${index}`}
      role="button"
      tabIndex={0}
      onClick={item.onClick}
    >
      {iconNode && <div {...stylex.props(styles.itemIcon)}>{iconNode}</div>}
      <div {...stylex.props(styles.itemContent)}>{item.label}</div>
      {item.extra}
    </div>
  );

  if (!item.popoverContent) return row;

  // The detail card is a hover information surface: keep it inert
  // (pointer-events: none) so a press can never land on the portal'd card and
  // be read as an outside press that dismisses the surrounding popover.
  return (
    <Popover
      arrow={false}
      content={item.popoverContent}
      disabled={detailPopoverDisabled}
      mouseEnterDelay={0.3}
      open={open}
      placement={detailPlacement}
      positionerProps={{ sideOffset: 8 }}
      styles={{ content: { padding: 0 }, root: { pointerEvents: 'none' } }}
      onOpenChange={onOpenChange}
    >
      {row}
    </Popover>
  );
});

const GroupItem = memo<{
  detailPlacement?: 'leftTop' | 'rightTop';
  detailPopoverDisabled?: boolean;
  index: number;
  item: ToolItemData;
}>(({ detailPlacement, detailPopoverDisabled, item, index }) => (
  <Fragment key={item.key || `group-${index}`}>
    <Text className={stylex.props(styles.groupLabel).className} fontSize={12} type="secondary">
      {item.label}
    </Text>
    {item.children?.map((child, childIndex) => (
      <ToolListItem
        detailPlacement={detailPlacement}
        detailPopoverDisabled={detailPopoverDisabled}
        index={childIndex}
        item={child}
        key={child.key || `item-${childIndex}`}
      />
    ))}
  </Fragment>
));

const ToolListItem = memo<{
  detailPlacement?: 'leftTop' | 'rightTop';
  detailPopoverDisabled?: boolean;
  index: number;
  item: ToolItemData | null;
}>(({ detailPlacement, detailPopoverDisabled, item, index }) => {
  if (!item) return null;
  if (item.type === 'divider') return <DividerItem index={index} />;
  if (item.type === 'group')
    return (
      <GroupItem
        detailPlacement={detailPlacement}
        detailPopoverDisabled={detailPopoverDisabled}
        index={index}
        item={item}
      />
    );
  return (
    <RegularItem
      detailPlacement={detailPlacement}
      detailPopoverDisabled={detailPopoverDisabled}
      index={index}
      item={item}
    />
  );
});

const ToolsList = memo<ToolsListProps>(({ detailPlacement, detailPopoverDisabled, items }) => {
  return (
    <Flexbox gap={0} padding={4}>
      {items.map((item, index) => (
        <ToolListItem
          detailPlacement={detailPlacement}
          detailPopoverDisabled={detailPopoverDisabled}
          index={index}
          item={item as ToolItemData | null}
          key={item?.key || `item-${index}`}
        />
      ))}
    </Flexbox>
  );
});

export default ToolsList;
