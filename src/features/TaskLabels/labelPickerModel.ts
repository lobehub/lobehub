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
