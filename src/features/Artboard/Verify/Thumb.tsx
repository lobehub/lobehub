import type { ArtboardFrame } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import FrameBody from '../Canvas/FrameBody';
import { FRAME_H, FRAME_W } from '../model';

export const thumbStyles = stylex.create({
  box: {
    aspectRatio: '16 / 10',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    flex: '1',
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  empty: {
    alignItems: 'center',
    borderStyle: 'dashed',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: 12,
    justifyContent: 'center',
    padding: 8,
    textAlign: 'center',
  },
});

export const Thumb = ({ frame, tone }: { frame: ArtboardFrame; tone?: string }) => {
  const board = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScale(el.clientWidth / FRAME_W));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      {...sx(thumbStyles.box, undefined, tone ? { borderColor: tone, borderWidth: 2 } : undefined)}
    >
      <div
        style={{
          height: FRAME_H,
          pointerEvents: 'none',
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          width: FRAME_W,
        }}
      >
        <FrameBody
          live
          frame={frame}
          imageUrl={
            frame.source.kind === 'image' ? board.imageUrls[frame.source.fileId] : undefined
          }
        />
      </div>
    </div>
  );
};

export const EmptyThumb = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(thumbStyles.box, thumbStyles.empty)}>{children}</div>
);
