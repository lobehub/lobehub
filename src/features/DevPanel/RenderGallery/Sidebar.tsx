'use client';

import { Menu, type MenuProps, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    padding-block: 16px 12px;
    padding-inline: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  menu: css`
    padding-block: 8px;
    border-inline-end: none !important;
  `,
  sidebar: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;

    width: 260px;
    height: 100%;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  scroll: css`
    overflow: auto;
    flex: 1;
  `,
}));

interface SidebarProps {
  items: MenuProps['items'];
  onSelect: (key: string) => void;
  selectedKey?: string;
}

const Sidebar = memo<SidebarProps>(({ items, selectedKey, onSelect }) => (
  <aside className={styles.sidebar}>
    <div className={styles.header}>
      <Text fontSize={13} type={'secondary'} weight={600}>
        Builtin Tool Renders
      </Text>
    </div>
    <div className={styles.scroll}>
      <Menu
        className={styles.menu}
        items={items}
        mode={'inline'}
        selectedKeys={selectedKey ? [selectedKey] : []}
        onClick={({ key }) => onSelect(key)}
      />
    </div>
  </aside>
));

export default Sidebar;
