import type { ArtboardBoardView } from '@lobechat/types';

export const LIVE_MIN_WIDTH = 96;
export const MAX_LIVE = 24;

interface Viewport {
  height: number;
  k: number;
  width: number;
  x: number;
  y: number;
}

const readableInView = ({ rect }: ArtboardBoardView, view: Viewport) => {
  if (rect.w * view.k < LIVE_MIN_WIDTH) return false;
  const left = rect.x * view.k + view.x;
  const top = rect.y * view.k + view.y;
  return (
    left < view.width &&
    top < view.height &&
    left + rect.w * view.k > 0 &&
    top + rect.h * view.k > 0
  );
};

// A mounted Canvas is never dropped for zooming out or panning away: the overview must keep
// showing real screens. Only the cap releases one, the board seen least recently first.
export const nextLiveBoards = (
  previous: readonly string[],
  boards: ArtboardBoardView[],
  view: Viewport,
): readonly string[] => {
  const onPage = new Set(boards.map((b) => b.id));
  const seen = boards.filter((b) => readableInView(b, view)).map((b) => b.id);
  const fresh = new Set(seen);
  const next = [...seen, ...previous.filter((id) => onPage.has(id) && !fresh.has(id))].slice(
    0,
    MAX_LIVE,
  );
  return next.length === previous.length && next.every((id, i) => id === previous[i])
    ? previous
    : next;
};
