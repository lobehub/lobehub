import type { ItemType } from '@lobehub/ui';
import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ReactNode } from 'react';
import { Fragment, isValidElement, memo } from 'react';

import { useDetailPopoverState } from '../components/useDetailPopoverState';
import { useScrollSignal } from './ScrollSignalContext';

export const toolsListStyles = createStaticStyles(({ css }) => ({
  groupLabel: css`
    padding-block: 12px 4px;
    padding-inline: 12px;
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 6px;

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemContent: css`
    flex: 1;
    min-width: 0;
  `,
  itemIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
  `,
}));

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
  detailPopoverDisabled?: boolean;
  items: ItemType[];
}

const DividerItem = memo<{ index: number }>(({ index }) => (
  <Divider key={`divider-${index}`} style={{ margin: '4px 0' }} />
));

const RegularItem = memo<{
  detailPopoverDisabled?: boolean;
  index: number;
  item: ToolItemData;
}>(({ detailPopoverDisabled, item, index }) => {
  const { close, onOpenChange, open } = useDetailPopoverState(detailPopoverDisabled);

  // Close hover popover whenever the surrounding list scrolls — avoids the
  // detail panel hovering in mid-air after its anchor row has moved away.
  useScrollSignal(close);

  const iconNode = item.icon ? (
    isValidElement(item.icon) ? (
      item.icon
    ) : (
      <Icon icon={item.icon as any} size={20} />
    )
  ) : null;

  const row = (
    <div
      className={toolsListStyles.item}
      key={item.key || `item-${index}`}
      role="button"
      tabIndex={0}
      onClick={item.onClick}
    >
      {iconNode && <div className={toolsListStyles.itemIcon}>{iconNode}</div>}
      <div className={toolsListStyles.itemContent}>{item.label}</div>
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
      placement={'rightTop'}
      positionerProps={{ sideOffset: 8 }}
      styles={{ content: { padding: 0 }, root: { pointerEvents: 'none' } }}
      onOpenChange={onOpenChange}
    >
      {row}
    </Popover>
  );
});

const GroupItem = memo<{
  detailPopoverDisabled?: boolean;
  index: number;
  item: ToolItemData;
}>(({ detailPopoverDisabled, item, index }) => (
  <Fragment key={item.key || `group-${index}`}>
    <Text className={toolsListStyles.groupLabel} fontSize={12} type="secondary">
      {item.label}
    </Text>
    {item.children?.map((child, childIndex) => (
      <ToolListItem
        detailPopoverDisabled={detailPopoverDisabled}
        index={childIndex}
        item={child}
        key={child.key || `item-${childIndex}`}
      />
    ))}
  </Fragment>
));

const ToolListItem = memo<{
  detailPopoverDisabled?: boolean;
  index: number;
  item: ToolItemData | null;
}>(({ detailPopoverDisabled, item, index }) => {
  if (!item) return null;
  if (item.type === 'divider') return <DividerItem index={index} />;
  if (item.type === 'group')
    return <GroupItem detailPopoverDisabled={detailPopoverDisabled} index={index} item={item} />;
  return <RegularItem detailPopoverDisabled={detailPopoverDisabled} index={index} item={item} />;
});

const ToolsList = memo<ToolsListProps>(({ detailPopoverDisabled, items }) => {
  return (
    <Flexbox gap={0} padding={4}>
      {items.map((item, index) => (
        <ToolListItem
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
