/**
 * Rules about an environment's instances that the server and the client both
 * apply. Kept in one place because the two sides answer the same questions —
 * which instance is the default, what a derived directory is called — and an
 * answer that differs between them shows the person one thing and enforces
 * another.
 */

/**
 * How many derived directories to try before giving up.
 *
 * A bound rather than a loop until success: the only way to exhaust it is a
 * member who already holds fifty directories under one name, and at that point
 * the honest answer is to say so rather than keep probing the index.
 */
export const MAX_DERIVED_DIRECTORY_ATTEMPTS = 50;

/**
 * A directory name derived from an environment's name.
 *
 * Letters and digits of any script survive — a Chinese environment name should
 * not become a row of dashes — while everything else collapses to `-`, because
 * this name is handed to a shell as a path. Interior spaces are legal in a
 * workspace path and still not worth minting: every command the agent writes
 * would need to quote them.
 *
 * Leading dots are stripped rather than escaped, which also puts `.sandbox`
 * (the reserved platform directory) out of reach without naming it here.
 */
export const environmentDirectorySlug = (name: string): string => {
  const slug = name
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, '-')
    .slice(0, 48)
    .replaceAll(/^[.-]+|[.-]+$/g, '');

  // Every character was punctuation, or the name was dots. Nothing is derivable
  // from it, so fall back to a word rather than to an empty path.
  return slug || 'environment';
};

/**
 * The directory to try on a given attempt (1-based): the slug itself first,
 * then `slug-2`, `slug-3`, … The derived name doubles as the instance's label
 * until someone renames it.
 */
export const derivedInstanceDirectory = (environmentName: string, attempt: number): string => {
  const base = environmentDirectorySlug(environmentName);

  return attempt <= 1 ? base : `${base}-${attempt}`;
};

/** The fields the default rule reads; any instance row satisfies it. */
export interface DefaultInstanceCandidate {
  createdAt: Date | string;
  id: string;
}

const createdAtMs = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

/**
 * Orders instances the way the default rule ranks them: earliest `createdAt`
 * first, and by id when two were created at the same moment, so every caller
 * agrees on the winner no matter what order the list arrived in.
 */
export const compareInstancesForDefault = (
  a: DefaultInstanceCandidate,
  b: DefaultInstanceCandidate,
): number => {
  const byCreation = createdAtMs(a.createdAt) - createdAtMs(b.createdAt);
  if (byCreation !== 0) return byCreation;

  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

/**
 * An environment's default instance: the one created first.
 *
 * Derived rather than stored, so there is no column to keep in sync. A new
 * environment's default is the instance created alongside it; an older one
 * with several instances gets its earliest, which is the one its owner has
 * been using longest. Pass one environment's instances — the rule does not
 * group by environment.
 */
export const pickDefaultInstance = <T extends DefaultInstanceCandidate>(
  instances: readonly T[],
): T | undefined => {
  let picked: T | undefined;

  for (const instance of instances) {
    if (!picked || compareInstancesForDefault(instance, picked) < 0) picked = instance;
  }

  return picked;
};

/** Whether `instance` is the default among its environment's `instances`. */
export const isDefaultInstance = (
  instance: Pick<DefaultInstanceCandidate, 'id'>,
  instances: readonly DefaultInstanceCandidate[],
): boolean => pickDefaultInstance(instances)?.id === instance.id;

/**
 * Marks each instance with whether it is its environment's default, for a list
 * that may span several environments. The client reads the flag rather than
 * re-deriving the rule, so the picker, the settings page and the server's
 * delete guard all agree on which copy is the default.
 */
export const markDefaultInstances = <
  T extends DefaultInstanceCandidate & { environmentId: string },
>(
  instances: readonly T[],
): (T & { isDefault: boolean })[] => {
  const byEnvironment = new Map<string, T[]>();
  for (const instance of instances) {
    const group = byEnvironment.get(instance.environmentId);
    if (group) group.push(instance);
    else byEnvironment.set(instance.environmentId, [instance]);
  }

  const defaults = new Set<string>();
  for (const group of byEnvironment.values()) {
    const picked = pickDefaultInstance(group);
    if (picked) defaults.add(picked.id);
  }

  return instances.map((instance) => ({ ...instance, isDefault: defaults.has(instance.id) }));
};
