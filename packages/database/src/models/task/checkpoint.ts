import type { CheckpointConfig, CheckpointTaskRef, TaskItem } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

/** Old writers can leave stale pairs behind when replacing only the label list. */
export const checkpointTaskPairsMatch = (
  ids: readonly string[] | undefined,
  pairs: readonly CheckpointTaskRef[] | undefined,
): boolean => {
  if (!pairs) return false;
  const identifiers = new Set(ids ?? []);
  const snapshots = new Set(pairs.map((pair) => pair.identifier));
  return identifiers.size === snapshots.size && [...identifiers].every((id) => snapshots.has(id));
};

/** Trust stable ids only while their label snapshots agree with the legacy field. */
export const checkpointTaskMatcher = (
  ids: readonly string[] | undefined,
  pairs: readonly CheckpointTaskRef[] | undefined,
): ((child: Pick<TaskItem, 'id' | 'identifier'>) => boolean) => {
  if (checkpointTaskPairsMatch(ids, pairs)) {
    const taskIds = new Set(pairs!.map((pair) => pair.id));
    return (child) => taskIds.has(child.id);
  }
  return (child) => ids?.includes(child.identifier) ?? false;
};

export interface CheckpointTaskRelocation {
  source: CheckpointTaskRef;
  target: CheckpointTaskRef;
}

/** Relocate both representations, preserving exact, inactive historical values. */
export const remapCheckpointConfig = (
  config: TaskItem['config'],
  relocations: readonly CheckpointTaskRelocation[],
): TaskItem['config'] => {
  if (!isRecord(config)) return config;
  const checkpoint = config.checkpoint as CheckpointConfig | undefined;
  if (!checkpoint?.tasks) return config;
  const byId = new Map(relocations.map(({ source, target }) => [source.id, target]));
  const byIdentifier = new Map(
    relocations.map(({ source, target }) => [source.identifier, target]),
  );
  const tasks = { ...checkpoint.tasks };
  for (const [idsKey, pairsKey] of [
    ['beforeIds', 'beforeTasks'],
    ['afterIds', 'afterTasks'],
  ] as const) {
    const ids = tasks[idsKey];
    if (!ids) continue;
    const pairs = tasks[pairsKey];
    const references = checkpointTaskPairsMatch(ids, pairs)
      ? pairs!.map((pair) => byId.get(pair.id) ?? pair)
      : ids.map((identifier) => byIdentifier.get(identifier) ?? { identifier });
    tasks[idsKey] = [...new Set(references.map((ref) => ref.identifier))];
    tasks[pairsKey] = [
      ...new Map(
        references.flatMap((ref) => ('id' in ref ? [[ref.id, ref] as const] : [])),
      ).values(),
    ];
  }
  return { ...config, checkpoint: { ...checkpoint, tasks } };
};
