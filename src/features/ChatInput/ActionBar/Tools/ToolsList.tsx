import { Flexbox, Icon, type ItemType, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ReactNode } from 'react';
import { Fragment, isValidElement, memo } from 'react';

export const toolsListStyles = createStaticStyles(({ css }) => ({
  groupLabel: css`
    padding-block: 4px;
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

    .ant-avatar {
      margin-inline-end: 0;
    }
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

const ToolsList = memo<ToolsListProps>(({ items }) => {
  const renderItem = (item: ToolItemData, index: number) => {
    if (item.type === 'divider') {
      return <Divider key={`divider-${index}`} style={{ margin: '4px 0' }} />;
    }

    if (item.type === 'group') {
      return (
        <Fragment key={item.key || `group-${index}`}>
          <Text className={toolsListStyles.groupLabel} fontSize={12} type="secondary">
            {item.label}
          </Text>
          {item.children?.map((child, childIndex) => renderItem(child, childIndex))}
        </Fragment>
      );
    }

    // Regular item
    // icon can be: ReactNode (already rendered), LucideIcon/ForwardRef (needs Icon wrapper), or undefined
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
        onClick={item.onClick}
        role="button"
        tabIndex={0}
      >
        {iconNode && <div className={toolsListStyles.itemIcon}>{iconNode}</div>}
        <div className={toolsListStyles.itemContent}>{item.label}</div>
        {item.extra}
      </div>
    );
  };

  return (
    <Flexbox gap={0} padding={4}>
      {items.map((item, index) => renderItem(item as ToolItemData, index))}
    </Flexbox>
  );
});

export default ToolsList;
