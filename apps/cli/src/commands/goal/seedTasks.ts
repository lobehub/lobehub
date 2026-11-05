import type { GoalGraphSnapshot } from '@lobechat/types';
import type { GoalSeedTask } from '@lobechat/utils/goalSeeds';

/**
 * `--task-file`: a JSON array of seed tasks, each a title or
 * {"title","description","dependsOn"}. `dependsOn` names other entries of the
 * same file by title; the server draws them as `depends_on` edges while it
 * creates the goal, so the seeded graph arrives with its order in place.
 */
export const parseTaskFile = (raw: string): Array<GoalSeedTask | string> => {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('--task-file must hold a JSON array');
  const tasks = parsed.map((item, index): GoalSeedTask | string => {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (!item || typeof item !== 'object' || typeof item.title !== 'string' || !item.title.trim())
      throw new Error(`--task-file entry ${index} needs a title`);
    if (
      item.dependsOn !== undefined &&
      (!Array.isArray(item.dependsOn) ||
        !item.dependsOn.every((dep: unknown) => typeof dep === 'string'))
    )
      throw new Error(`--task-file entry ${index}: dependsOn must be an array of task titles`);
    return {
      dependsOn: item.dependsOn?.map((dep: string) => dep.trim()),
      description: typeof item.description === 'string' ? item.description : undefined,
      title: item.title.trim(),
    };
  });
  return tasks;
};

/**
 * Seed dependencies the created graph does not carry. A server that predates
 * `dependsOn` drops the field silently, so the CLI checks what came back
 * instead of trusting that it was understood.
 */
export const missingSeedDependencies = (
  graph: Pick<GoalGraphSnapshot, 'edges' | 'nodes'>,
  seeds: Array<GoalSeedTask | string>,
): string[] => {
  if (!seeds.some((seed) => typeof seed !== 'string' && seed.dependsOn?.length)) return [];
  const titleById = new Map(graph.nodes.map((node) => [node.id, node.title]));
  const drawn = new Set(
    graph.edges
      .filter((edge) => edge.kind === 'depends_on')
      .map(
        (edge) => `${titleById.get(edge.sourceNodeId)}\u0000${titleById.get(edge.targetNodeId)}`,
      ),
  );
  return seeds.flatMap((seed) =>
    typeof seed === 'string'
      ? []
      : (seed.dependsOn ?? [])
          .filter((dep) => !drawn.has(`${seed.title}\u0000${dep}`))
          .map((dep) => `"${seed.title}" depends on "${dep}"`),
  );
};
