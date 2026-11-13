import type { StyleElement } from '../extract';

const localSlots = (element: StyleElement) =>
  new Set(element.slots.map((slot) => slot.slice(slot.indexOf('.') + 1)));

export const matchScore = (a: StyleElement, b: StyleElement) => {
  const left = localSlots(a);
  const right = localSlots(b);
  const shared = [...left].filter((slot) => right.has(slot)).length;
  const union = new Set([...left, ...right]).size;
  const overlap = union ? shared / union : 0;
  if (a.tag !== b.tag && overlap === 0) return 0;
  return (a.tag === b.tag ? 1 : 0) + overlap * 2;
};

export const alignElements = (base: StyleElement[], head: StyleElement[]) => {
  const rows = base.length + 1;
  const cols = head.length + 1;
  const score = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 1; i < rows; i++)
    for (let j = 1; j < cols; j++) {
      const match = matchScore(base[i - 1], head[j - 1]);
      score[i][j] = Math.max(
        score[i - 1][j],
        score[i][j - 1],
        match > 0 ? score[i - 1][j - 1] + match : -Infinity,
      );
    }
  const pairs: Array<[StyleElement, StyleElement]> = [];
  let i = base.length;
  let j = head.length;
  while (i > 0 && j > 0) {
    const match = matchScore(base[i - 1], head[j - 1]);
    if (match > 0 && score[i][j] === score[i - 1][j - 1] + match) {
      pairs.unshift([base[i - 1], head[j - 1]]);
      i--;
      j--;
    } else if (score[i][j] === score[i - 1][j]) i--;
    else j--;
  }
  const pairedBase = new Set(pairs.map(([a]) => a));
  const pairedHead = new Set(pairs.map(([, b]) => b));
  return {
    pairs,
    unpairedBase: base.filter((element) => !pairedBase.has(element)),
    unpairedHead: head.filter((element) => !pairedHead.has(element)),
  };
};
