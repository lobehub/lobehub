import type { ArtboardBoardView } from '@lobechat/types';

export const LIVE_MIN_WIDTH = 240;

interface Viewport {
  height: number;
  k: number;
  width: number;
  x: number;
  y: number;
}

export const liveBoardKey = (boards: ArtboardBoardView[], view: Viewport) =>
  boards
    .filter(({ rect }) => {
      if (rect.w * view.k < LIVE_MIN_WIDTH) return false;
      const left = rect.x * view.k + view.x;
      const top = rect.y * view.k + view.y;
      return (
        left < view.width &&
        top < view.height &&
        left + rect.w * view.k > 0 &&
        top + rect.h * view.k > 0
      );
    })
    .map((b) => b.id)
    .join(' ');
