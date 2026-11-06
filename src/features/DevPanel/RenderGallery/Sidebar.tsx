'use client';

import { type DropdownItem, List, type ListItem, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

const styles = stylex.create({
  menu: { paddingBlock: '4px' },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    width: '260px',
    height: '100%',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  scroll: { overflow: 'auto', flex: '1' },
});

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
    <aside {...stylex.props(styles.sidebar)}>
      <div {...stylex.props(devDockPanelStyles.paneHeader)}>
        <Text fontSize={13} type={'secondary'} weight={600}>
          Builtin Tool Renders
        </Text>
      </div>
      <div {...stylex.props(styles.scroll)}>
        <List
          activeKey={selectedKey ?? null}
          className={stylex.props(styles.menu).className}
          items={listItems}
          onClick={({ key }) => onSelect(String(key))}
        />
      </div>
    </aside>
  );
});

export default Sidebar;
