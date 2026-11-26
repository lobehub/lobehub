export const GROUP_TOP = 144;
export const GROUP_LABEL_FONT = 13;
export const GROUP_LABEL_GAP = 26;
const GROUP_LABEL_ROW = 20;
const BASE = 27;
const FOLLOW = 0.7;
const MIN_FONT = 4;
const HIDE_BELOW = 0.05;

export const groupLabelScale = (k: number, band = GROUP_TOP): number | null => {
  if (k < HIDE_BELOW) return null;
  const size = Math.max(Math.min(BASE * k ** FOLLOW, BASE), MIN_FONT);
  const scale = Math.min(size / GROUP_LABEL_FONT, (band * k) / (GROUP_LABEL_GAP + GROUP_LABEL_ROW));
  return scale * GROUP_LABEL_FONT < MIN_FONT ? null : scale;
};

export const roundOrder = (
  rounds: { id: string; pageId: string }[],
  pageId: string | undefined,
): Record<string, number> =>
  Object.fromEntries(
    rounds.filter((round) => round.pageId === pageId).map((round, i) => [round.id, i + 1]),
  );

export type GroupChip = { kind: 'lock' } | { kind: 'text'; text: string };

export const groupChip = ({
  locked,
  roundNumber,
}: {
  locked: boolean;
  roundNumber?: number;
}): GroupChip | null => {
  if (locked) return { kind: 'lock' };
  return roundNumber ? { kind: 'text', text: `Q${roundNumber}` } : null;
};
