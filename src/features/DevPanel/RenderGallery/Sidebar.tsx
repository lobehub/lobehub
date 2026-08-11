'use client';

import { Menu, type MenuProps, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  menu: css`
    padding-block: 4px;
    border-inline-end: none !important;

    .ant-menu-item,
    .ant-menu-submenu-title {
      width: 100%;
      margin-inline: 0;
      border-radius: 0;
    }
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
    <div className={devDockPanelStyles.paneHeader}>
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
