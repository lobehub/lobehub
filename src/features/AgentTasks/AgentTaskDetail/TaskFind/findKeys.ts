export type FindKeyAction = 'close' | 'next' | 'prev';

/** What a key pressed in the find input does — the browser find-bar conventions. */
export const resolveFindKey = (key: string, shiftKey: boolean): FindKeyAction | undefined => {
  if (key === 'Enter') return shiftKey ? 'prev' : 'next';
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'prev';
  if (key === 'Escape') return 'close';
  return undefined;
};
