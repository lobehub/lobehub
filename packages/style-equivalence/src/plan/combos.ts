export type Combo = Record<string, boolean | string>;

export const FULL_ENUMERATION_LIMIT = 4;

export const fullCombos = (names: string[]): Combo[] => {
  const combos: Combo[] = [];
  for (let mask = 0; mask < 2 ** names.length; mask++)
    combos.push(
      Object.fromEntries(names.map((name, index) => [name, Boolean(mask & (1 << index))])),
    );
  return combos;
};

export const pairwiseCombos = (names: string[]): Combo[] => {
  const uncovered = new Set<string>();
  const key = (i: number, vi: boolean, j: number, vj: boolean) => `${i}:${+vi}|${j}:${+vj}`;
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (const vi of [false, true])
        for (const vj of [false, true]) uncovered.add(key(i, vi, j, vj));
  const cover = (values: boolean[]) => {
    for (let i = 0; i < values.length; i++)
      for (let j = i + 1; j < values.length; j++) uncovered.delete(key(i, values[i], j, values[j]));
  };
  const rows: boolean[][] = [];
  while (uncovered.size) {
    const [first] = uncovered;
    const [left, right] = first.split('|').map((part) => part.split(':').map(Number));
    const values: boolean[] = names.map(() => false);
    values[left[0]] = Boolean(left[1]);
    values[right[0]] = Boolean(right[1]);
    for (let index = 0; index < names.length; index++) {
      if (index === left[0] || index === right[0]) continue;
      let best = false;
      let bestGain = -1;
      for (const candidate of [false, true]) {
        values[index] = candidate;
        let gain = 0;
        for (let other = 0; other < names.length; other++) {
          if (other === index) continue;
          const [i, j] = other < index ? [other, index] : [index, other];
          if (uncovered.has(key(i, values[i], j, values[j]))) gain++;
        }
        if (gain > bestGain) {
          bestGain = gain;
          best = candidate;
        }
      }
      values[index] = best;
    }
    cover(values);
    rows.push(values);
  }
  return rows.map((values) =>
    Object.fromEntries(names.map((name, index) => [name, values[index]])),
  );
};

export const DOMAIN_COMBO_LIMIT = 64;

export const combosFor = (names: string[], domains: Record<string, string[]> = {}) => {
  const flags = names.filter((name) => !domains[name]);
  const pairwise = flags.length > FULL_ENUMERATION_LIMIT;
  let combos = pairwise ? pairwiseCombos(flags) : fullCombos(flags);
  for (const name of names)
    if (domains[name])
      combos = combos.flatMap((combo) =>
        domains[name].map((value) => ({ ...combo, [name]: value })),
      );
  return { combos, pairwise };
};
