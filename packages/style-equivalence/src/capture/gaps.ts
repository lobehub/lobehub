const kindOf = (entry: string) => entry.slice(0, entry.indexOf('|'));

const caseOf = (section: string) => section.slice(0, section.lastIndexOf('|'));

const byCase = (sections: Record<string, string[]>) => {
  const cases = new Map<string, Map<string, string[]>>();
  for (const [section, entries] of Object.entries(sections)) {
    const kinds = cases.get(caseOf(section)) ?? new Map<string, string[]>();
    cases.set(caseOf(section), kinds);
    for (const entry of entries) {
      const kind = kindOf(entry);
      kinds.set(kind, [...(kinds.get(kind) ?? []), entry.slice(entry.indexOf('|') + 1)]);
    }
  }
  return cases;
};

export const caseGapsOf = (base: Record<string, string[]>, head: Record<string, string[]>) => {
  const [left, right] = [byCase(base), byCase(head)];
  const gaps: Record<string, string[]> = {};
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const kinds = new Set([...(left.get(key)?.keys() ?? []), ...(right.get(key)?.keys() ?? [])]);
    const differing = [...kinds].filter((kind) => {
      const [a, b] = [left.get(key)?.get(kind) ?? [], right.get(key)?.get(kind) ?? []].map((list) =>
        [...new Set(list)].sort().join('\n'),
      );
      return a !== b;
    });
    if (differing.length) gaps[key] = differing.sort();
  }
  return gaps;
};
