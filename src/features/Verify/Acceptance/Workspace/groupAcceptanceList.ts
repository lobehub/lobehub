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
