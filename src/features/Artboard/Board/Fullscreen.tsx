import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { sx } from '@/styles/sx';

import BoardView from '.';

const OVERLAY_ATTR = 'data-artboard-fullscreen';

const styles = stylex.create({
  overlay: {
    backgroundColor: cssVar.colorBgLayout,
    display: 'flex',
    flexDirection: 'column',
    insetBlockStart: 0,
    insetInline: 0,
    position: 'fixed',
    zIndex: 100,
  },
});

const findChatInput = () =>
  [...document.querySelectorAll<HTMLElement>('[data-testid="chat-input"]')]
    .filter((el) => !el.closest(`[${OVERLAY_ATTR}]`) && el.offsetWidth > 0)
    .sort((a, b) => b.offsetWidth - a.offsetWidth)[0];

const useChatInputInset = (enabled: boolean) => {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const input = findChatInput();
    if (!input) return;
    const measure = () =>
      setInset(Math.max(0, window.innerHeight - input.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled]);
  return inset;
};

interface ArtboardFullscreenProps {
  artboardId: string;
  footer?: ReactNode;
  onClose: () => void;
}

export const ArtboardFullscreen = ({ artboardId, footer, onClose }: ArtboardFullscreenProps) => {
  const inset = useChatInputInset(!footer);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      {...{ [OVERLAY_ATTR]: '' }}
      {...sx(styles.overlay, undefined, { bottom: footer ? 0 : inset })}
    >
      <BoardView artboardId={artboardId} onExitFullscreen={onClose} />
      {footer}
    </div>,
    document.body,
  );
};
