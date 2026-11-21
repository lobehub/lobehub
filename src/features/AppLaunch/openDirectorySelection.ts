/**
 * Pure selection rules for "open this directory in the app".
 *
 * Kept free of services and store imports so the behaviour that decides which
 * conversation a launch lands on can be tested without a tRPC client — this is
 * the part that is easy to get subtly wrong (wrong folder, duplicated
 * conversation) and hard to notice afterwards.
 */

/** The fields of a bound project directory this module matches against. */
export interface BoundDirectoryLike {
  /** Desktop device that owns the directory; a path only exists on that machine. */
  deviceId?: string;
  id: string;
  path: string;
  projectId: string;
  /** Whether a run can actually start here (linked, enabled, writable). */
  runnable?: boolean;
}

export interface BoundTopicLike {
  id: string;
  updatedAt: Date | string;
}

/**
 * Trailing separators are the one difference that is never meaningful:
 * `/repo` and `/repo/` are the same folder, and both spellings reach us
 * depending on whether the path was typed, dropped, or came from `pwd`.
 *
 * Case is NOT folded — on a case-sensitive volume `/Repo` and `/repo` are two
 * different directories, and silently merging them would open the wrong
 * project.
 */
export const normalizeComparablePath = (candidate: string): string => {
  const trimmed = candidate.trim().replace(/[/\\]+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

const isAncestor = (parent: string, child: string): boolean => {
  if (parent === '/') return true;
  return child.startsWith(`${parent}/`) || child.startsWith(`${parent}\\`);
};

/**
 * Pick the bound directory a launch should open.
 *
 * Candidates are restricted to `deviceId` first: a workspace can hold several
 * machines with the same path, and `runnable` only reflects enablement and
 * write permission — not whose disk it is. Without that filter a launch on one
 * machine can open another machine's project, and a remote exact match even
 * beats a local ancestor match.
 *
 * An exact match wins. Failing that the nearest ancestor does, because `lh app
 * .` inside `repo/apps/desktop` should land on the conversation bound to
 * `repo` — refusing it would make the command useless from anywhere but the
 * repository root. Ancestors are compared longest-first so a nested binding
 * beats the umbrella project around it.
 *
 * Between equally good candidates a `runnable` directory wins: a stale binding
 * whose device is offline must not shadow a live one.
 */
export const pickDirectoryForPath = <T extends BoundDirectoryLike>(
  directories: readonly T[],
  targetPath: string,
  options: { deviceId?: string } = {},
): undefined | { directory: T; matchedParent: boolean } => {
  const { deviceId } = options;
  // Without a known local device there is no safe candidate: every match could
  // belong to another machine, so the caller falls back to the project list.
  if (!deviceId) return undefined;

  const target = normalizeComparablePath(targetPath);
  const byPreference = (a: T, b: T) => Number(b.runnable === true) - Number(a.runnable === true);
  const localDirectories = directories.filter((directory) => directory.deviceId === deviceId);

  const exact = [...localDirectories]
    .filter((directory) => normalizeComparablePath(directory.path) === target)
    .sort(byPreference)[0];
  if (exact) return { directory: exact, matchedParent: false };

  const ancestors = localDirectories
    .map((directory) => ({ directory, normalized: normalizeComparablePath(directory.path) }))
    .filter(({ normalized }) => isAncestor(normalized, target))
    .sort(
      (a, b) => b.normalized.length - a.normalized.length || byPreference(a.directory, b.directory),
    );

  const best = ancestors[0];
  return best ? { directory: best.directory, matchedParent: true } : undefined;
};

/**
 * Resolve a launch to a bound directory, tolerating a cold start.
 *
 * A launch replays as soon as the navigation bridge mounts, which can beat both
 * the session's first data fetch and the local device identity — and a missing
 * device id or an empty list is indistinguishable from "nothing is bound" at a
 * single point in time. This keeps asking until the device is known and the
 * list has an answer, then stops at the deadline so a genuinely unbound
 * directory still reaches the project list.
 */
export const resolveDirectoryMatch = async <T extends BoundDirectoryLike>({
  getDeviceId,
  list,
  pollMs = 500,
  targetPath,
  timeoutMs = 10_000,
}: {
  /** Polled until it answers: device identity arrives after the renderer boots. */
  getDeviceId: () => string | undefined;
  list: () => Promise<T[] | null | undefined>;
  pollMs?: number;
  targetPath: string;
  timeoutMs?: number;
}): Promise<undefined | { directory: T; matchedParent: boolean }> => {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const deviceId = getDeviceId();

    if (deviceId) {
      try {
        const directories = await list();
        const match = pickDirectoryForPath(directories ?? [], targetPath, { deviceId });
        if (match) return match;
      } catch (error) {
        console.warn('[openDirectory] Failed to list project directories', error);
      }
    }

    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};

/**
 * The conversation to reveal for a directory: the most recently updated one.
 * `listTopics` returns ascending `updatedAt`, but sorting here keeps the rule
 * independent of that query detail.
 */
export const pickLatestTopic = <T extends BoundTopicLike>(topics: readonly T[]): T | undefined =>
  [...topics].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
