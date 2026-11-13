/** A seed task as a Goal is created with it; `dependsOn` names other seeds by title. */
export interface GoalSeedTask {
  dependsOn?: string[];
  description?: string;
  title: string;
}

const seedTitle = (seed: GoalSeedTask | string) => (typeof seed === 'string' ? seed : seed.title);

/**
 * Why the seeds' `dependsOn` cannot be drawn as `depends_on` edges, or
 * `undefined` when it can. A cycle is refused too: every task on it would wait
 * for another, so the Goal would start with nothing it could dispatch.
 */
export const goalSeedDependencyProblem = (
  seeds: Array<GoalSeedTask | string>,
): string | undefined => {
  const dependencies = new Map<string, string[]>();
  for (const seed of seeds) {
    if (typeof seed !== 'string' && seed.dependsOn?.length)
      dependencies.set(seed.title, seed.dependsOn);
  }
  if (dependencies.size === 0) return undefined;

  const titles = seeds.map(seedTitle);
  const duplicate = titles.find((title, index) => titles.indexOf(title) !== index);
  if (duplicate) return `"${duplicate}" appears twice, so dependsOn cannot name it`;
  for (const [title, deps] of dependencies) {
    for (const dep of deps) {
      if (dep === title) return `"${title}" cannot depend on itself`;
      if (!titles.includes(dep)) return `"${title}" depends on "${dep}", which is not a seed task`;
    }
  }

  // Depth-first walk; reaching a title still on the stack closes a cycle.
  const state = new Map<string, 'done' | 'visiting'>();
  const visit = (title: string, path: string[]): string[] | undefined => {
    if (state.get(title) === 'done') return undefined;
    if (state.get(title) === 'visiting') return [...path.slice(path.indexOf(title)), title];
    state.set(title, 'visiting');
    for (const dep of dependencies.get(title) ?? []) {
      const cycle = visit(dep, [...path, title]);
      if (cycle) return cycle;
    }
    state.set(title, 'done');
    return undefined;
  };
  for (const title of dependencies.keys()) {
    const cycle = visit(title, []);
    if (cycle) return `dependsOn forms a cycle: ${cycle.map((item) => `"${item}"`).join(' → ')}`;
  }
  return undefined;
};
