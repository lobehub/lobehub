import type { VerdictEntry } from './api';

export const FALSE_POSITIVE = 'TOOL_FALSE_POSITIVE';
export const UNPAIRED = 'UNPAIRED';

export interface SignoffGroup {
  batch: boolean;
  items: VerdictEntry[];
  reason: string;
}

const reasonsOf = (item: VerdictEntry) => {
  if (item.category === 'unpaired') return [UNPAIRED];
  if (item.category === 'difference') return item.flags.length ? [FALSE_POSITIVE] : [];
  if (item.category === 'needs-signoff') return item.flags;
  return [];
};

export const signoffGroups = (items: VerdictEntry[]): SignoffGroup[] => {
  const groups = new Map<string, VerdictEntry[]>();
  for (const item of items)
    for (const reason of reasonsOf(item)) groups.set(reason, [...(groups.get(reason) ?? []), item]);
  return [...groups]
    .map(([reason, list]) => ({ batch: reason !== UNPAIRED, items: list, reason }))
    .sort(
      (a, b) =>
        Number(a.reason === UNPAIRED) - Number(b.reason === UNPAIRED) ||
        b.items.length - a.items.length ||
        a.reason.localeCompare(b.reason),
    );
};

export const signedFor = (item: VerdictEntry, reason: string) =>
  item.signoff === 'valid' || (item.signedReasons ?? []).includes(reason);

export const signoffProgress = (items: VerdictEntry[]) => {
  const signable = items.filter((item) => reasonsOf(item).length);
  return {
    signed: signable.filter((item) => item.signoff === 'valid').length,
    total: signable.length,
  };
};

export type Submission =
  | { body: { keys: string[]; note: string; reason: string } }
  | { error: 'NOTE_REQUIRED' | 'NOTHING_SELECTED' | 'UNPAIRED_ONE_BY_ONE' };

export const submission = (group: SignoffGroup, selected: string[], note: string): Submission => {
  const keys = group.items.map((item) => item.key).filter((key) => selected.includes(key));
  if (!keys.length) return { error: 'NOTHING_SELECTED' };
  if (!group.batch && keys.length > 1) return { error: 'UNPAIRED_ONE_BY_ONE' };
  if (!note.trim()) return { error: 'NOTE_REQUIRED' };
  return { body: { keys, note: note.trim(), reason: group.reason } };
};
