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
 * The only color values a label may hold: chips render them straight into an
 * inline `background`, so anything else is a CSS injection point.
 */
export const TASK_LABEL_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

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

/** The registry fields `resolveTaskLabelRefs` reads. */
export type TaskLabelRegistryEntry = Pick<TaskLabel, 'id' | 'isGroup' | 'name' | 'parentId'>;

export interface TaskLabelRefResolution {
  /** Resolved label ids, in input order, de-duplicated. */
  ids: string[];
  /** Inputs that resolved to nothing assignable, each with close existing names. */
  unresolved: { input: string; reason: 'group' | 'notFound'; suggestions: string[] }[];
}

const normalizeLabelName = (value: string) => value.trim().toLowerCase();

/** Display path of a label: `Group/Label` for a grouped one, the bare name otherwise. */
export const formatTaskLabelPath = (
  label: Pick<TaskLabel, 'name' | 'parentId'>,
  registry: Pick<TaskLabel, 'id' | 'name'>[],
): string => {
  const group = label.parentId ? registry.find((entry) => entry.id === label.parentId) : undefined;
  return group ? `${group.name}${TASK_LABEL_PATH_SEPARATOR}${label.name}` : label.name;
};

const editDistance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
};

/**
 * Resolve label names typed by a person or an agent (`Bug`, `type/bug`) to
 * label ids. Names are unique per scope, so a bare name is enough; a path
 * must also name the right group. Nothing is created: an unknown name comes
 * back as unresolved with the closest existing labels as suggestions, so a
 * typo never silently grows the registry.
 */
export const resolveTaskLabelRefs = (
  registry: TaskLabelRegistryEntry[],
  inputs: string[],
): TaskLabelRefResolution => {
  const assignable = registry.filter((label) => !label.isGroup);
  const ids: string[] = [];
  const unresolved: TaskLabelRefResolution['unresolved'] = [];

  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) continue;

    const separator = input.lastIndexOf(TASK_LABEL_PATH_SEPARATOR);
    const groupName = separator > 0 ? normalizeLabelName(input.slice(0, separator)) : undefined;
    const name = normalizeLabelName(separator > 0 ? input.slice(separator + 1) : input);

    // A whole input that is itself a label name wins over the path reading,
    // so a label literally named "UI/UX" still resolves.
    const exact = registry.find(
      (label) => normalizeLabelName(label.name) === normalizeLabelName(input),
    );
    const match =
      exact ??
      (groupName !== undefined
        ? assignable.find((label) => {
            if (normalizeLabelName(label.name) !== name || !label.parentId) return false;
            const group = registry.find((entry) => entry.id === label.parentId);
            return !!group && normalizeLabelName(group.name) === groupName;
          })
        : undefined);

    if (match && !match.isGroup) {
      if (!ids.includes(match.id)) ids.push(match.id);
      continue;
    }

    const needle = normalizeLabelName(input);
    const suggestions = assignable
      .map((label) => ({ label, path: formatTaskLabelPath(label, registry) }))
      .map(({ label, path }) => {
        const candidate = normalizeLabelName(label.name);
        const distance = Math.min(
          editDistance(needle, candidate),
          editDistance(needle, normalizeLabelName(path)),
        );
        const related = candidate.includes(name) || name.includes(candidate);
        return { distance: related ? Math.min(distance, 1) : distance, path };
      })
      .filter(({ distance }) => distance <= Math.max(2, Math.floor(needle.length / 3)))
      .sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path))
      .slice(0, 5)
      .map(({ path }) => path);

    if (match?.isGroup) {
      const children = assignable
        .filter((label) => label.parentId === match.id)
        .map((label) => formatTaskLabelPath(label, registry));
      unresolved.push({ input, reason: 'group', suggestions: children });
    } else {
      unresolved.push({ input, reason: 'notFound', suggestions });
    }
  }

  return { ids, unresolved };
};

/** One readable line per unresolved input, for CLI and tool error messages. */
export const describeUnresolvedTaskLabels = (
  unresolved: TaskLabelRefResolution['unresolved'],
): string =>
  unresolved
    .map(({ input, reason, suggestions }) => {
      const head =
        reason === 'group'
          ? `"${input}" is a label group; pick one of its labels`
          : `Label "${input}" not found`;
      return suggestions.length > 0 ? `${head} (did you mean: ${suggestions.join(', ')}?)` : head;
    })
    .join('\n');

/**
 * The label change that undoes one applied `changeForTask`, touching only what
 * that call itself changed — never a full-set replacement, so labels another
 * client changed meanwhile survive the rollback.
 *
 * - `before`: labels on the task right before the change
 * - `add` / `remove`: the delta that was applied
 * - `after`: label ids the change returned
 * - `current`: labels on the task now, read right before rolling back
 *
 * What this change took away (explicitly, or as a group sibling it swapped
 * out) comes back only if nobody has touched it since: an ungrouped label only
 * when it is still absent, a grouped one only while its group holds nothing
 * but this change's own label (or nothing at all). Only labels this change
 * added that are still there are taken away.
 */
export const invertTaskLabelChange = (
  before: readonly Pick<TaskLabelRef, 'id' | 'parentId'>[],
  { add = [] }: { add?: readonly string[]; remove?: readonly string[] },
  after: readonly string[],
  current: readonly Pick<TaskLabelRef, 'id' | 'parentId'>[],
): { add: string[]; remove: string[] } => {
  const beforeIds = new Set(before.map((label) => label.id));
  const afterIds = new Set(after);
  const currentIds = new Set(current.map((label) => label.id));
  const ours = new Set(add.filter((id) => !beforeIds.has(id) && afterIds.has(id)));
  const oursStillCurrent = current.filter((label) => ours.has(label.id));
  // Groups someone else has put a label into since this change.
  const groupsTakenByOthers = new Set(
    current.flatMap((label) => (label.parentId && !ours.has(label.id) ? [label.parentId] : [])),
  );

  return {
    add: before
      .filter((label) => !afterIds.has(label.id) && !currentIds.has(label.id))
      .filter((label) => !label.parentId || !groupsTakenByOthers.has(label.parentId))
      .map((label) => label.id),
    remove: oursStillCurrent.map((label) => label.id),
  };
};
