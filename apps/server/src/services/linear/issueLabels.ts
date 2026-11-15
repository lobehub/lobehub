import { TASK_LABEL_COLOR_PATTERN, TASK_LABEL_NAME_MAX_LENGTH } from '@lobechat/types';

import type { LinearIssue } from './issues';

/** A Linear label as a task label: its name, color and the group it sits in. */
export interface LinearLabelSpec {
  color: string | null;
  group?: { color: string | null; name: string };
  /** Compares names the way the label registry does: trimmed and case-insensitive. */
  key: string;
  name: string;
}

const toLabelName = (name: string) => name.trim().slice(0, TASK_LABEL_NAME_MAX_LENGTH).trim();

/**
 * Label colors are rendered into an inline `background`, and this one comes from
 * outside, so anything but a hex literal is dropped like the router does.
 */
const toLabelColor = (color?: string | null) =>
  color && TASK_LABEL_COLOR_PATTERN.test(color) ? color : null;

export const linearLabelKey = (name: string) => toLabelName(name).toLowerCase();

/** The labels of an issue, once each. */
export const linearIssueLabels = (issue: LinearIssue): LinearLabelSpec[] => {
  const labels = new Map<string, LinearLabelSpec>();
  for (const { color, name, parent } of issue.labels?.nodes ?? []) {
    const key = linearLabelKey(name);
    if (!key || labels.has(key)) continue;
    const groupName = parent ? toLabelName(parent.name) : '';
    labels.set(key, {
      color: toLabelColor(color),
      group: groupName ? { color: toLabelColor(parent?.color), name: groupName } : undefined,
      key,
      name: toLabelName(name),
    });
  }
  return [...labels.values()];
};
