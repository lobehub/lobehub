import type { ArtboardRect } from '@lobechat/types';

export const GROUP_LABEL_HEIGHT = 30;
const GROUP_LABEL_FONT = 15;
const MIN_READABLE_FONT = 9;

const sharesColumns = (a: ArtboardRect, b: ArtboardRect) => a.x < b.x + b.w && b.x < a.x + a.w;

export const groupLabelRoom = (
  groups: { id: string; rect: ArtboardRect }[],
  looseBoards: ArtboardRect[],
): Record<string, number> => {
  const obstacles = [...groups.map((group) => group.rect), ...looseBoards];
  return Object.fromEntries(
    groups.map(({ id, rect }) => {
      let room = Infinity;
      for (const other of obstacles) {
        if (other === rect || other.y >= rect.y || !sharesColumns(rect, other)) continue;
        room = Math.min(room, Math.max(0, rect.y - (other.y + other.h)));
      }
      return [id, room];
    }),
  );
};

export const groupLabelScale = (k: number, room: number): number | null => {
  const scale = Math.min(1 / k, room / GROUP_LABEL_HEIGHT);
  return GROUP_LABEL_FONT * scale * k >= MIN_READABLE_FONT ? scale : null;
};
