import type { TaskLabel, TaskLabelRef } from '@lobechat/types';

export interface TaskLabelPickerSection {
  /** The group, or undefined for the top-level labels. */
  group?: TaskLabel;
  labels: TaskLabel[];
}

const matches = (value: string, query: string) => value.toLowerCase().includes(query);

/**
 * Picker sections: ungrouped labels first, then one section per group with
 * its labels. A search keeps a label when its own name or its group's name
 * matches; empty groups are left out.
 */
export const buildTaskLabelPickerSections = (
  registry: TaskLabel[],
  keyword = '',
): TaskLabelPickerSection[] => {
  const query = keyword.trim().toLowerCase();
  const groups = registry.filter((label) => label.isGroup);
  const groupIds = new Set(groups.map((group) => group.id));
  const assignable = registry.filter((label) => !label.isGroup);

  const loose = assignable.filter(
    (label) => (!label.parentId || !groupIds.has(label.parentId)) && matches(label.name, query),
  );
  const sections: TaskLabelPickerSection[] = loose.length > 0 ? [{ labels: loose }] : [];

  for (const group of groups) {
    const groupMatches = !!query && matches(group.name, query);
    const labels = assignable.filter(
      (label) => label.parentId === group.id && (groupMatches || matches(label.name, query)),
    );
    if (labels.length > 0) sections.push({ group, labels });
  }

  return sections;
};

export const toTaskLabelRef = (label: TaskLabel): TaskLabelRef => ({
  color: label.color,
  id: label.id,
  name: label.name,
  parentId: label.parentId,
});

/**
 * Resolve label ids against the registry, keeping the ids' order. Ids the
 * registry does not hold (deleted, or from another workspace) are dropped, and
 * group rows are never returned (they cannot be assigned).
 */
export const resolveTaskLabelRefs = (
  registry: TaskLabel[],
  ids: readonly string[] | undefined,
): TaskLabelRef[] => {
  if (!ids?.length) return [];
  const byId = new Map(registry.map((label) => [label.id, label]));
  return ids.flatMap((id) => {
    const label = byId.get(id);
    return label && !label.isGroup ? [toTaskLabelRef(label)] : [];
  });
};

/**
 * The `labelIds` to create a task with: the picked labels, or — when nothing
 * is picked yet because the registry has not loaded — the ids still waiting to
 * be resolved (the server validates them). Empty → no key.
 */
export const pickedLabelIds = (
  picked: TaskLabelRef[],
  pending: readonly string[] | undefined,
): { labelIds?: string[] } => {
  if (picked.length > 0) return { labelIds: picked.map((label) => label.id) };
  return pending?.length ? { labelIds: [...pending] } : {};
};

/**
 * Toggle one label in a selection. Picking a grouped label replaces the
 * sibling from the same group (one label per group, as the server enforces).
 */
export const toggleTaskLabelSelection = (
  selected: TaskLabelRef[],
  label: TaskLabel,
): TaskLabelRef[] => {
  if (selected.some((item) => item.id === label.id)) {
    return selected.filter((item) => item.id !== label.id);
  }
  const rest = label.parentId
    ? selected.filter((item) => item.parentId !== label.parentId)
    : selected;
  return [...rest, toTaskLabelRef(label)];
};

/** Whether `keyword` would create a new label: non-empty and no exact (case-insensitive) name. */
export const canCreateTaskLabel = (registry: TaskLabel[], keyword: string): boolean => {
  const name = keyword.trim().toLowerCase();
  return !!name && !registry.some((label) => label.name.toLowerCase() === name);
};
