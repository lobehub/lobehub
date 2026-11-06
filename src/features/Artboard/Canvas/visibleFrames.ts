import type { ArtboardFrame } from '@lobechat/types';

import { FRAME_H, FRAME_W } from '../model';

export const LIVE_MIN_WIDTH = 240;

interface Viewport {
  height: number;
  k: number;
  width: number;
  x: number;
  y: number;
}

export const liveFrameKey = (frames: ArtboardFrame[], view: Viewport) => {
  if (FRAME_W * view.k < LIVE_MIN_WIDTH) return '';
  return frames
    .filter((f) => {
      const left = f.x * view.k + view.x;
      const top = f.y * view.k + view.y;
      return (
        left < view.width &&
        top < view.height &&
        left + FRAME_W * view.k > 0 &&
        top + FRAME_H * view.k > 0
      );
    })
    .map((f) => f.id)
    .join(' ');
};
