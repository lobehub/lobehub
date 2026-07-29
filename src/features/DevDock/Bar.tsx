'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDown, Wrench } from 'lucide-react';
import { Fragment, memo } from 'react';

import { BAR_HEIGHT, DOCK_Z_INDEX } from './const';
import OverflowMenu from './OverflowMenu';
import { PinnedAction, PinnedSelect, PinnedToggle, WidgetSlot } from './pinnedItems';
import {
  type DevDockItem,
  type DevDockPanelItem,
  selectBarLayout,
  useDevDockItems,
} from './registry';
import { useDevDockStore } from './store';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    flex-shrink: 0;

    width: 100%;
    height: ${BAR_HEIGHT}px;
    margin-block-start: -8px;
    padding-inline: 8px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
  center: css`
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
  `,
  divider: css`
    flex-shrink: 0;
    width: 1px;
    height: 12px;
    background: ${cssVar.colorBorderSecondary};
  `,
  iconButton: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  pill: css`
    cursor: pointer;

    position: fixed;
    z-index: ${DOCK_Z_INDEX};
    inset-block-end: 0;
    inset-inline-start: 16px;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    height: 18px;
    padding-inline: 8px;
    border: none;
    border-start-start-radius: 6px;
    border-start-end-radius: 6px;

    font-size: 10px;
    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorText};

    &:hover {
      opacity: 0.85;
    }
  `,
  tab: css`
    cursor: pointer;

    display: inline-flex;
    gap: 5px;
    align-items: center;

    height: 20px;
    padding-inline: 8px;
    border: none;
    border-radius: 4px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  tabActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
}));

const PanelTab = memo<{ item: DevDockPanelItem }>(({ item }) => {
  const active = useDevDockStore((s) => s.activePanelId === item.id);
  const togglePanel = useDevDockStore((s) => s.togglePanel);
  const Icon = item.icon;
  const Badge = item.badge;
  return (
    <button
      className={cx(styles.tab, active && styles.tabActive)}
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
        className={styles.pill}
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
    <Flexbox horizontal align={'center'} className={styles.bar} gap={8}>
      <button
        className={styles.iconButton}
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
        <div className={styles.center}>
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
            {needsDivider && <span className={styles.divider} />}
            <PinnedItem item={item} />
          </Fragment>
        );
      })}
      {right.length > 0 && <span className={styles.divider} />}
      <OverflowMenu />
    </Flexbox>
  );
});

Bar.displayName = 'DevDockBar';

export default Bar;
