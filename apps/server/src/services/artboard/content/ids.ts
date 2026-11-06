import type { ArtboardContent } from '@lobechat/types';

const PREFIX = { arrow: 'a', frame: 'f', group: 'g', note: 'n' } as const;
const COLLECTION = { arrow: 'arrows', frame: 'frames', group: 'groups', note: 'notes' } as const;

export type ArtboardItemKind = keyof typeof PREFIX;

export const nextArtboardId = (content: ArtboardContent, kind: ArtboardItemKind) => {
  const prefix = PREFIX[kind];
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const max = content[COLLECTION[kind]].reduce((highest, item) => {
    const match = pattern.exec(item.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${prefix}${max + 1}`;
};
