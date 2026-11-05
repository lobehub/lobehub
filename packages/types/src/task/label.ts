/**
 * Task labels (Linear-style). A workspace-level registry of colored labels,
 * optionally grouped one level deep. A group (`isGroup`) is never attached to
 * a task; a task carries at most one label from each group.
 */
export interface TaskLabel {
  color?: string | null;
  description?: string | null;
  id: string;
  isGroup: boolean;
  name: string;
  /** The group this label belongs to, or null for a top-level label / a group. */
  parentId?: string | null;
  sortOrder: number;
}

/** A registry entry with the number of visible tasks carrying it. */
export interface TaskLabelWithUsage extends TaskLabel {
  usageCount: number;
}

/** The label fields a task row carries for display (list rows, kanban cards, detail). */
export interface TaskLabelRef {
  color?: string | null;
  id: string;
  name: string;
  parentId?: string | null;
}

/** Longest label name accepted by the router, CLI and agent tools. */
export const TASK_LABEL_NAME_MAX_LENGTH = 64;

/**
 * Separator for addressing a grouped label by path (`Type/Bug`). Names are
 * unique per scope, so the bare name also resolves; the path form only reads
 * better and is checked against the group.
 */
export const TASK_LABEL_PATH_SEPARATOR = '/';

/** Default palette offered by the label picker; values are CSS hex literals. */
export const TASK_LABEL_COLORS = [
  '#95A2B3',
  '#5E6AD2',
  '#26B5CE',
  '#4CB782',
  '#F2C94C',
  '#F2994A',
  '#EB5757',
  '#BB87FC',
] as const;

export const DEFAULT_TASK_LABEL_COLOR = TASK_LABEL_COLORS[0];
