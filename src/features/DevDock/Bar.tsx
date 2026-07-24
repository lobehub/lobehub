'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDown, Wrench } from 'lucide-react';
import { Component, memo, type PropsWithChildren, Suspense } from 'react';

import { BAR_HEIGHT, DOCK_Z_INDEX } from './const';
import {
  type DevDockPanelItem,
  type DevDockWidgetItem,
  getItemComponent,
  useDevDockItems,
} from './registry';
import { useDevDockStore } from './store';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    flex-shrink: 0;

    width: 100%;
    height: ${BAR_HEIGHT}px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgLayout};
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

class WidgetBoundary extends Component<PropsWithChildren, { failed?: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const WidgetSlot = memo<{ item: DevDockWidgetItem }>(({ item }) => {
  const Widget = getItemComponent(item);
  return (
    <WidgetBoundary>
      <Suspense fallback={null}>
        <Widget />
      </Suspense>
    </WidgetBoundary>
  );
});

WidgetSlot.displayName = 'DevDockWidgetSlot';

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
      <span>{item.title}</span>
      {Badge && <Badge />}
    </button>
  );
});

PanelTab.displayName = 'DevDockPanelTab';

const Bar = memo(() => {
  const expanded = useDevDockStore((s) => s.expanded);
  const setExpanded = useDevDockStore((s) => s.setExpanded);
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

  const panels = items.filter((item): item is DevDockPanelItem => item.type === 'panel');
  const widgets = items.filter((item): item is DevDockWidgetItem => item.type === 'widget');
  const leftWidgets = widgets.filter((item) => item.placement === 'left');
  const rightWidgets = widgets.filter((item) => item.placement === 'right');

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
      {leftWidgets.map((item) => (
        <WidgetSlot item={item} key={item.id} />
      ))}
      <Flexbox horizontal align={'center'} gap={2}>
        {panels.map((item) => (
          <PanelTab item={item} key={item.id} />
        ))}
      </Flexbox>
      <span style={{ flex: 1 }} />
      {rightWidgets.map((item) => (
        <WidgetSlot item={item} key={item.id} />
      ))}
    </Flexbox>
  );
});

Bar.displayName = 'DevDockBar';

export default Bar;
