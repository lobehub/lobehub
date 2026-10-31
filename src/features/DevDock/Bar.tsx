'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, Wrench } from 'lucide-react';
import { Fragment, memo } from 'react';

import { BAR_HEIGHT, BAR_OVERLAP, DOCK_Z_INDEX } from './const';
import OverflowMenu from './OverflowMenu';
import { PinnedAction, PinnedSelect, PinnedToggle, WidgetSlot } from './pinnedItems';
import {
  type DevDockItem,
  type DevDockPanelItem,
  selectBarLayout,
  useDevDockItems,
} from './registry';
import { useDevDockStore } from './store';

const styles = stylex.create({
  bar: (height: string, marginBlockStart: string) => ({
    flexShrink: 0,
    width: '100%',
    height,
    marginBlockStart,
    paddingInline: '8px',
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  }),
  center: { display: 'flex', flex: '1', alignItems: 'center', minWidth: 0 },
  divider: {
    flexShrink: 0,
    width: '1px',
    height: '12px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  iconButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderStyle: 'none',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  pill: (zIndex: number) => ({
    cursor: 'pointer',
    position: 'fixed',
    zIndex,
    insetBlockEnd: 0,
    insetInlineStart: '16px',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    height: '18px',
    paddingInline: '8px',
    borderStyle: 'none',
    borderStartStartRadius: '6px',
    borderStartEndRadius: '6px',
    fontSize: '10px',
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorText,
    backgroundImage: 'none',
    opacity: { 'default': null, ':hover': 0.85 },
  }),
  tab: {
    cursor: 'pointer',
    display: 'inline-flex',
    flexShrink: 0,
    gap: '4px',
    alignItems: 'center',
    height: '20px',
    paddingInline: '6px',
    borderStyle: 'none',
    borderRadius: '4px',
    fontSize: '11px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  tabActive: {
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
  },
});

const PanelTab = memo<{ item: DevDockPanelItem }>(({ item }) => {
  const active = useDevDockStore((s) => s.activePanelId === item.id);
  const togglePanel = useDevDockStore((s) => s.togglePanel);
  const Icon = item.icon;
  const Badge = item.badge;
  return (
    <button
      {...stylex.props(styles.tab, active && styles.tabActive)}
      type={'button'}
      onClick={() => togglePanel(item.id)}
    >
      <Icon size={12} />
      <span>{item.label}</span>
      {Badge && <Badge />}
    </button>
  );
});

PanelTab.displayName = 'DevDockPanelTab';

const PinnedItem = memo<{ item: Exclude<DevDockItem, DevDockPanelItem> }>(({ item }) => {
  switch (item.type) {
    case 'action': {
      return <PinnedAction item={item} />;
    }
    case 'readout': {
      return <WidgetSlot item={item} />;
    }
    case 'select': {
      return <PinnedSelect item={item} />;
    }
    case 'toggle': {
      return <PinnedToggle item={item} />;
    }
  }
});

PinnedItem.displayName = 'DevDockPinnedItem';

const Bar = memo(() => {
  const expanded = useDevDockStore((s) => s.expanded);
  const setExpanded = useDevDockStore((s) => s.setExpanded);
  const activePanelId = useDevDockStore((s) => s.activePanelId);
  const pinOverrides = useDevDockStore((s) => s.pinOverrides);
  const items = useDevDockItems();

  if (!expanded)
    return (
      <button
        {...stylex.props(styles.pill(DOCK_Z_INDEX))}
        title={'Open DevDock'}
        type={'button'}
        onClick={() => setExpanded(true)}
      >
        <Wrench size={10} />
        <span>dev</span>
      </button>
    );

  const { center, right, tabs } = selectBarLayout(items, pinOverrides, activePanelId);

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={3}
      {...stylex.props(styles.bar(`${BAR_HEIGHT}px`, `-${BAR_OVERLAP}px`))}
    >
      <button
        {...stylex.props(styles.iconButton)}
        title={'Collapse DevDock'}
        type={'button'}
        onClick={() => setExpanded(false)}
      >
        <ChevronDown size={12} />
      </button>
      <Flexbox horizontal align={'center'} gap={2}>
        {tabs.map((item) => (
          <PanelTab item={item} key={item.id} />
        ))}
      </Flexbox>
      {center ? (
        <div {...stylex.props(styles.center)}>
          <WidgetSlot item={center} />
        </div>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      {right.map((item, index) => {
        const previous = right[index - 1];
        const needsDivider = index > 0 && item.type === 'readout' && previous?.type === 'readout';
        return (
          <Fragment key={item.id}>
            {needsDivider && <span {...stylex.props(styles.divider)} />}
            <PinnedItem item={item} />
          </Fragment>
        );
      })}
      {right.length > 0 && <span {...stylex.props(styles.divider)} />}
      <OverflowMenu />
    </Flexbox>
  );
});

Bar.displayName = 'DevDockBar';

export default Bar;
