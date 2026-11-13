import type { ArtboardBoardView } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import BoardBody from '../Canvas/BoardBody';

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

export const Thumb = ({ board: item, tone }: { board: ArtboardBoardView; tone?: string }) => {
  const board = useBoard();
  const { h, w } = item.rect;
  const { source } = item;
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScale(el.clientWidth / w));
    observer.observe(el);
    return () => observer.disconnect();
  }, [w]);

  return (
    <div
      ref={ref}
      {...sx(thumbStyles.box, undefined, tone ? { borderColor: tone, borderWidth: 2 } : undefined)}
    >
      <div
        style={{
          height: h,
          pointerEvents: 'none',
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          width: w,
        }}
      >
        <BoardBody
          live
          board={item}
          imageUrl={source?.kind === 'image' ? board.imageUrls[source.fileId] : undefined}
        />
      </div>
    </div>
  );
};

export const EmptyThumb = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(thumbStyles.box, thumbStyles.empty)}>{children}</div>
);
