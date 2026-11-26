interface GroupableOption {
  /** Section title the option sits under; options without one render at the top level. */
  group?: string;
}

export type GroupedFilterEntry<T extends GroupableOption> =
  { kind: 'group'; label: string; options: T[] } | { kind: 'option'; option: T };

/**
 * Folds a field's flat option list into menu sections: consecutive options that
 * share a `group` become one titled section, ungrouped ones stay top level. The
 * order of the input is kept, so "Unassigned" and the viewer stay above the
 * "Workspace members" section the way the Assign picker lays them out.
 */
export const groupFilterOptions = <T extends GroupableOption>(
  options: T[],
): GroupedFilterEntry<T>[] => {
  const entries: GroupedFilterEntry<T>[] = [];
  for (const option of options) {
    if (!option.group) {
      entries.push({ kind: 'option', option });
      continue;
    }
    const last = entries.at(-1);
    if (last?.kind === 'group' && last.label === option.group) last.options.push(option);
    else entries.push({ kind: 'group', label: option.group, options: [option] });
  }
  return entries;
};
