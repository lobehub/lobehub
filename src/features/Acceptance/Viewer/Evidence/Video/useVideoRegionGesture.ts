import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import type { VideoPlayer } from '@lobehub/ui';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useState } from 'react';

type Rect = AcceptanceReviewAnnotation['rect'];

/** Draw a comment against the frame shown when the gesture starts. */
export const useVideoRegionGesture = (
  player: VideoPlayer,
  onRegion?: (note: { rect: Rect; time: { start: number } }) => void,
) => {
  const [draft, setDraft] = useState<Rect | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const box = element.getBoundingClientRect();
    const origin = {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    };
    const wasPlaying = !player.getState().paused;
    const start = player.getState().time;
    player.pause();
    element.setPointerCapture(event.pointerId);
    let current: Rect | null = null;
    const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
    const move = (next: PointerEvent) => {
      const x = clamp((next.clientX - box.left) / box.width);
      const y = clamp((next.clientY - box.top) / box.height);
      current = {
        height: Math.abs(y - origin.y),
        width: Math.abs(x - origin.x),
        x: Math.min(x, origin.x),
        y: Math.min(y, origin.y),
      };
      setDraft(current);
    };
    const clean = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      setDraft(null);
    };
    const cancel = () => clean();
    const up = () => {
      clean();
      if (current && current.width > 0.02 && current.height > 0.02)
        onRegion?.({ rect: current, time: { start } });
      else if (!wasPlaying) player.toggle();
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
  };
  return { draft, onPointerDown };
};
