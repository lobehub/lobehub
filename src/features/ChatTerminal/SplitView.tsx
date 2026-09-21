'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { XIcon } from 'lucide-react';
import { Fragment, type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DIVIDER_WIDTH, paneTrackWidth, resizePanes } from './paneLayout';
import type { TerminalPane } from './store';
import TerminalView from './TerminalView';

const styles = createStaticStyles(({ css, cssVar }) => ({
  close: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 2px;
    inset-inline-end: 2px;

    opacity: 0;

    transition: opacity 0.15s;
  `,
  divider: css`
    cursor: col-resize;
    position: relative;
    flex: none;
    inline-size: ${DIVIDER_WIDTH}px;

    &::after {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: ${(DIVIDER_WIDTH - 1) / 2}px;

      inline-size: 1px;

      background: ${cssVar.colorBorderSecondary};

      transition: background 0.15s;
    }

    &:hover::after {
      background: ${cssVar.colorPrimary};
    }
  `,
  pane: css`
    position: relative;
    overflow: hidden;
    min-inline-size: 0;
    transition: opacity 0.15s;

    /* Set only while split, so a lone pane is never dimmed. */
    &[data-inactive-pane] {
      opacity: 0.7;
    }

    &:hover [data-pane-close],
    &:focus-within [data-pane-close] {
      opacity: 1;
    }
  `,
  root: css`
    display: flex;
    block-size: 100%;
  `,
}));

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
    <div className={styles.root} ref={rootRef}>
      {panes.map((pane, index) => (
        <Fragment key={pane.id}>
          {index > 0 && (
            <div className={styles.divider} onPointerDown={handleDividerDown(index - 1)} />
          )}
          <div
            className={styles.pane}
            data-inactive-pane={split && pane.id !== activePaneId ? '' : undefined}
            style={{ flex: `${flex[index]} 1 0` }}
            onPointerDownCapture={() => onActivatePane(pane.id)}
          >
            {split && (
              <div data-pane-close className={styles.close}>
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
