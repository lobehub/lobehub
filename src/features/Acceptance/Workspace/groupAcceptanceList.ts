import type { AcceptanceListItem } from '@/services/verify';

export interface AcceptanceListGroup {
  items: AcceptanceListItem[];
  key: string;
  projectName: string | null;
}

const UNGROUPED_KEY = 'ungrouped';

export const groupAcceptanceList = (items: AcceptanceListItem[]): AcceptanceListGroup[] => {
  const groups = new Map<string, AcceptanceListGroup>();

  for (const item of items) {
    const key = item.project?.id ?? UNGROUPED_KEY;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(key, {
      items: [item],
      key,
      projectName: item.project?.name ?? null,
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (!a.projectName) return 1;
    if (!b.projectName) return -1;
    return a.projectName.localeCompare(b.projectName);
  });
};

export const hasProjectAcceptanceGroups = (groups: AcceptanceListGroup[]) =>
  groups.some(({ projectName }) => projectName !== null);

/**
 * Which groups the accordion shows open. Expressed as "everything except what
 * the user collapsed" on purpose: a group that appears AFTER mount — the one
 * the user just filed a delivery into — must be open, or the row they moved
 * silently disappears behind a collapsed header.
 */
export const expandedAcceptanceGroupKeys = (
  groups: AcceptanceListGroup[],
  collapsedKeys: string[],
) => groups.map(({ key }) => key).filter((key) => !collapsedKeys.includes(key));

/**
 * Fold an accordion change back into the collapsed set.
 *
 * Only the groups the list is currently showing can be reported by the
 * accordion, so a group hidden behind the active filter/search keeps whatever
 * the user last chose for it. Rebuilding the set from the visible groups alone
 * would silently re-open it the moment the filter is cleared.
 */
export const nextCollapsedGroupKeys = (
  previousCollapsed: string[],
  groups: AcceptanceListGroup[],
  expandedKeys: string[],
) => {
  const visible = new Set(groups.map(({ key }) => key));
  const expanded = new Set(expandedKeys);

  return [
    ...previousCollapsed.filter((key) => !visible.has(key)),
    ...groups.map(({ key }) => key).filter((key) => !expanded.has(key)),
  ];
};
