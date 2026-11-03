import {
  describeUnresolvedTaskLabels,
  resolveTaskLabelRefs,
  type TaskLabelRegistryEntry,
} from '@lobechat/types';

/** `error` is set when any name is unknown; `ids` is then empty. */
export interface ToolLabelResolution {
  error?: string;
  ids: string[];
}

/**
 * Resolve label names an agent passed (`Bug`, `Type/Bug`) against the scope's
 * registry. Unknown names are an error that lists close existing labels —
 * tools never create labels, so a hallucinated or misspelled name cannot grow
 * the shared registry.
 *
 * `allowGroups` is for filters: a group name there means "any label of the
 * group", while assignment must name one concrete label.
 */
export const resolveToolLabelIds = (
  registry: TaskLabelRegistryEntry[],
  names: string[] | undefined,
  { allowGroups = false }: { allowGroups?: boolean } = {},
): ToolLabelResolution => {
  const inputs = (names ?? []).map((name) => name.trim()).filter(Boolean);
  if (inputs.length === 0) return { ids: [] };

  const groupIds: string[] = [];
  const labelNames: string[] = [];
  for (const input of inputs) {
    const group = allowGroups
      ? registry.find((label) => label.isGroup && label.name.toLowerCase() === input.toLowerCase())
      : undefined;
    if (group) groupIds.push(group.id);
    else labelNames.push(input);
  }

  const { ids, unresolved } = resolveTaskLabelRefs(registry, labelNames);
  if (unresolved.length > 0) {
    const available = registry.filter((label) => !label.isGroup).length;
    return {
      ids: [],
      error: `${describeUnresolvedTaskLabels(unresolved)}\n${
        available > 0
          ? 'Use only existing label names; labels are created by the user in task settings.'
          : 'This workspace has no task labels yet; omit labels.'
      }`,
    };
  }
  return { ids: [...new Set([...groupIds, ...ids])] };
};
