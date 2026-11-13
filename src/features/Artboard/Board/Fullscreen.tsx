import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import BoardView from '.';

const styles = stylex.create({
  overlay: {
    backgroundColor: cssVar.colorBgLayout,
    display: 'flex',
    flexDirection: 'column',
    inset: 0,
    position: 'fixed',
    zIndex: 100,
  },
});

interface ArtboardFullscreenProps {
  artboardId: string;
  onClose: () => void;
}

export const ArtboardFullscreen = ({ artboardId, onClose }: ArtboardFullscreenProps) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div {...stylex.props(styles.overlay)}>
      <BoardView artboardId={artboardId} onExitFullscreen={onClose} />
    </div>,
    document.body,
  );
};
