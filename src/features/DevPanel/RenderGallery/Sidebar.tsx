'use client';

import { type DropdownItem, List, type ListItem, Text  } from '@lobehub/ui';
import { createStaticStyles } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  menu: css`
    padding-block: 4px;
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
  items: DropdownItem[];
  onSelect: (key: string) => void;
  selectedKey?: string;
}

const Sidebar = memo<SidebarProps>(({ items, selectedKey, onSelect }) => {
  const listItems = useMemo<ListItem[]>(
    () =>
      (items ?? []).flatMap((item) =>
        item && 'label' in item && item.key != null ? [{ key: item.key, label: item.label }] : [],
      ),
    [items],
  );

  return (
    <aside className={styles.sidebar}>
      <div className={devDockPanelStyles.paneHeader}>
        <Text fontSize={13} type={'secondary'} weight={600}>
          Builtin Tool Renders
        </Text>
      </div>
      <div className={styles.scroll}>
        <List
          activeKey={selectedKey ?? null}
          className={styles.menu}
          items={listItems}
          onClick={({ key }) => onSelect(String(key))}
        />
      </div>
    </aside>
  );
});

export default Sidebar;
