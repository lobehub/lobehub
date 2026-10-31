'use client';

import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { XIcon } from 'lucide-react';
import { Fragment, type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { DIVIDER_WIDTH, paneTrackWidth, resizePanes } from './paneLayout';
import type { TerminalPane } from './store';
import TerminalView from './TerminalView';

const styles = stylex.create({
  // Shown while the pane (a `stylex.defaultMarker()` element) is hovered or has focus inside.
  close: {
    insetBlockStart: '2px',
    insetInlineEnd: '2px',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
    position: 'absolute',
    transition: 'opacity 0.15s',
    zIndex: 1,
  },
  divider: {
    'cursor': 'col-resize',
    'flex': 'none',
    'position': 'relative',
    '::after': {
      backgroundColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorPrimary },
      backgroundImage: 'none',
      content: "''",
      insetBlock: 0,
      inlineSize: '1px',
      position: 'absolute',
      transition: 'background 0.15s',
    },
  },
  // paneLayout owns the width, which StyleX cannot read at build time.
  dividerSize: (width: number) => ({
    'inlineSize': `${width}px`,
    '::after': { insetInlineStart: `${(width - 1) / 2}px` },
  }),
  pane: {
    // Set only while split, so a lone pane is never dimmed.
    minInlineSize: 0,
    opacity: { 'default': null, '[data-inactive-pane]': 0.7 },
    overflow: 'hidden',
    position: 'relative',
    transition: 'opacity 0.15s',
  },
  root: {
    blockSize: '100%',
    display: 'flex',
  },
});

interface SplitViewProps {
  activePaneId: string;
  onActivatePane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onResize: (flex: number[]) => void;
  panes: TerminalPane[];
}

const SplitView = ({
  activePaneId,
  onActivatePane,
  onClosePane,
  onResize,
  panes,
}: SplitViewProps) => {
  const { t } = useTranslation('chat');
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragFlex, setDragFlex] = useState<number[]>();

  const flex = dragFlex?.length === panes.length ? dragFlex : panes.map((pane) => pane.flex);
  const split = panes.length > 1;

  const handleDividerDown =
    (dividerIndex: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!root) return;
      event.preventDefault();

      const startX = event.clientX;
      const start = [...flex];
      const trackWidth = paneTrackWidth(root.getBoundingClientRect().width, panes.length);
      let latest = start;

      const handleMove = (moveEvent: PointerEvent) => {
        const next = resizePanes(start, dividerIndex, moveEvent.clientX - startX, trackWidth);
        if (!next) return;
        latest = next;
        setDragFlex(next);
      };

      const handleUp = () => {
        globalThis.removeEventListener('pointermove', handleMove);
        globalThis.removeEventListener('pointerup', handleUp);
        setDragFlex(undefined);
        onResize(latest);
      };

      globalThis.addEventListener('pointermove', handleMove);
      globalThis.addEventListener('pointerup', handleUp);
    };

  return (
    <div {...stylex.props(styles.root)} ref={rootRef}>
      {panes.map((pane, index) => (
        <Fragment key={pane.id}>
          {index > 0 && (
            <div
              {...stylex.props(styles.divider, styles.dividerSize(DIVIDER_WIDTH))}
              onPointerDown={handleDividerDown(index - 1)}
            />
          )}
          <div
            {...sx([styles.pane, stylex.defaultMarker()], undefined, {
              flex: `${flex[index]} 1 0`,
            })}
            data-inactive-pane={split && pane.id !== activePaneId ? '' : undefined}
            onPointerDownCapture={() => onActivatePane(pane.id)}
          >
            {split && (
              <div {...stylex.props(styles.close)}>
                <ActionIcon
                  icon={XIcon}
                  size={{ blockSize: 20, size: 12 }}
                  title={t('terminalPanel.closePane')}
                  onClick={() => onClosePane(pane.id)}
                />
              </div>
            )}
            <TerminalView sessionId={pane.id} />
          </div>
        </Fragment>
      ))}
    </div>
  );
};

export default SplitView;
