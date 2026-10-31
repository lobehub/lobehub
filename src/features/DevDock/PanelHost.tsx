'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Maximize2, Minimize2, XIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { sx } from '@/styles/sx';

import { BAR_HEIGHT, BAR_OVERLAP } from './const';
import PanelErrorBoundary from './PanelErrorBoundary';
import { type DevDockPanelItem, getItemComponent, useDevDockItems } from './registry';
import { MIN_PANEL_HEIGHT, useDevDockStore } from './store';

const styles = stylex.create({
  content: { overflow: 'hidden', flex: '1', minWidth: 0, minHeight: 0 },
  header: {
    flexShrink: 0,
    height: '30px',
    paddingInline: '10px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  host: (marginBlockEnd: string) => ({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    width: '100%',
    marginBlockEnd,
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  }),
  resizeHandle: {
    touchAction: 'none',
    cursor: 'row-resize',
    position: 'absolute',
    zIndex: 1,
    insetBlockStart: '-3px',
    insetInline: 0,
    height: '6px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
});

const PanelHost = memo(() => {
  const expanded = useDevDockStore((s) => s.expanded);
  const activePanelId = useDevDockStore((s) => s.activePanelId);
  const maximized = useDevDockStore((s) => s.maximized);
  const panelHeight = useDevDockStore((s) => s.panelHeight);
  const setMaximized = useDevDockStore((s) => s.setMaximized);
  const setPanelHeight = useDevDockStore((s) => s.setPanelHeight);
  const togglePanel = useDevDockStore((s) => s.togglePanel);
  const items = useDevDockItems();

  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragging = dragHeight !== null;
  const dragOriginRef = useRef<{ height: number; pointerY: number } | null>(null);

  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (maximized) return;
      e.preventDefault();
      dragOriginRef.current = { height: panelHeight, pointerY: e.clientY };
      setDragHeight(panelHeight);
    },
    [maximized, panelHeight],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const next = origin.height + (origin.pointerY - e.clientY);
      const max = window.innerHeight - BAR_HEIGHT - 60;
      setDragHeight(Math.min(Math.max(MIN_PANEL_HEIGHT, next), max));
    };
    const onUp = () => {
      setDragHeight((committed) => {
        if (committed !== null) setPanelHeight(committed);
        return null;
      });
      dragOriginRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, setPanelHeight]);

  const item = items.find(
    (candidate): candidate is DevDockPanelItem =>
      candidate.type === 'panel' && candidate.id === activePanelId,
  );

  if (!expanded || !item) return null;

  const Content = getItemComponent(item);
  const Icon = item.icon;
  const height = maximized ? `calc(100dvh - ${BAR_HEIGHT}px)` : `${dragHeight ?? panelHeight}px`;

  return (
    <section {...sx([styles.host(`${BAR_OVERLAP}px`)], undefined, { height })}>
      {!maximized && <div {...stylex.props(styles.resizeHandle)} onPointerDown={handleDragStart} />}
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={6}
      >
        <Icon size={12} />
        <span>{item.label}</span>
        <span style={{ flex: 1 }} />
        <ActionIcon
          icon={maximized ? Minimize2 : Maximize2}
          size={'small'}
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => setMaximized(!maximized)}
        />
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={'Close panel'}
          onClick={() => togglePanel(item.id)}
        />
      </Flexbox>
      <div {...stylex.props(styles.content)}>
        <PanelErrorBoundary key={item.id}>
          <Suspense fallback={null}>
            <Content />
          </Suspense>
        </PanelErrorBoundary>
      </div>
    </section>
  );
});

PanelHost.displayName = 'DevDockPanelHost';

export default PanelHost;
