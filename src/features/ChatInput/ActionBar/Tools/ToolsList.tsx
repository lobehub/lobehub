import type { ItemType } from '@lobehub/ui';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ReactNode } from 'react';
import { Fragment, isValidElement, memo } from 'react';

export const toolsListStyles = createStaticStyles(({ css }) => ({
  groupLabel: css`
    padding-block-start: 12px;
    padding-block-end: 4px;
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
  type?: 'group' | 'divider';
}

interface ToolsListProps {
  items: ItemType[];
}

const DividerItem = memo<{ index: number }>(({ index }) => (
  <Divider key={`divider-${index}`} style={{ margin: '4px 0' }} />
));

const RegularItem = memo<{ index: number; item: ToolItemData }>(({ item, index }) => {
  const iconNode = item.icon ? (
    isValidElement(item.icon) ? (
      item.icon
    ) : (
      <Icon icon={item.icon as any} size={20} />
    )
  ) : null;

  return (
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
});

const GroupItem = memo<{ index: number; item: ToolItemData }>(({ item, index }) => (
  <Fragment key={item.key || `group-${index}`}>
    <Text className={toolsListStyles.groupLabel} fontSize={12} type="secondary">
      {item.label}
    </Text>
    {item.children?.map((child, childIndex) => (
      <ToolListItem index={childIndex} item={child} key={child.key || `item-${childIndex}`} />
    ))}
  </Fragment>
));

const ToolListItem = memo<{ index: number; item: ToolItemData | null }>(({ item, index }) => {
  if (!item) return null;
  if (item.type === 'divider') return <DividerItem index={index} />;
  if (item.type === 'group') return <GroupItem index={index} item={item} />;
  return <RegularItem index={index} item={item} />;
});

const ToolsList = memo<ToolsListProps>(({ items }) => {
  return (
    <Flexbox gap={0} padding={4}>
      {items.map((item, index) => (
        <ToolListItem
          index={index}
          item={item as ToolItemData | null}
          key={item?.key || `item-${index}`}
        />
      ))}
    </Flexbox>
  );
});

export default ToolsList;
