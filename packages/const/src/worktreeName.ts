/**
 * Auto-generated branch names for a freshly created worktree.
 *
 * Shape: `wt/<YYYYMMDDHHmm>-<adjective>-<noun>` — e.g. `wt/202610020308-quiet-hill`.
 * The minutes-precision timestamp keeps the branch list chronological when sorted
 * by name; the word pair keeps the name human-readable and, together with the
 * timestamp, makes a collision unlikely. Only lowercase ASCII and `-` are used,
 * so the name is always a valid git ref, and it folds cleanly into the worktree
 * folder name (`deriveWorktreePath` turns it into `<repo>-wt-202610020308-quiet-hill`).
 */

/** Namespace prefix, so worktrees created by the app group together in the branch list. */
export const WORKTREE_BRANCH_PREFIX = 'wt';

export const WORKTREE_ADJECTIVES = [
  'amber',
  'bold',
  'brave',
  'breezy',
  'bright',
  'brisk',
  'calm',
  'cheerful',
  'clever',
  'coastal',
  'crisp',
  'curious',
  'dapper',
  'eager',
  'early',
  'easy',
  'fancy',
  'fluent',
  'fresh',
  'gentle',
  'giddy',
  'glad',
  'golden',
  'grand',
  'handy',
  'hardy',
  'humble',
  'jolly',
  'keen',
  'lively',
  'lucid',
  'lucky',
  'mellow',
  'merry',
  'mighty',
  'nimble',
  'noble',
  'plucky',
  'proud',
  'quiet',
  'rapid',
  'ready',
  'silky',
  'smooth',
  'snowy',
  'solar',
  'steady',
  'sunny',
  'swift',
  'tender',
  'tidy',
] as const;

export const WORKTREE_NOUNS = [
  'acorn',
  'badger',
  'bamboo',
  'beacon',
  'bison',
  'brook',
  'canyon',
  'cedar',
  'cloud',
  'comet',
  'coral',
  'creek',
  'dawn',
  'delta',
  'ember',
  'falcon',
  'fern',
  'forest',
  'fox',
  'harbor',
  'heron',
  'hill',
  'island',
  'jade',
  'lagoon',
  'lantern',
  'lark',
  'maple',
  'meadow',
  'mesa',
  'mist',
  'moon',
  'moss',
  'oak',
  'ocean',
  'otter',
  'peak',
  'pine',
  'pond',
  'prairie',
  'quartz',
  'raven',
  'reed',
  'river',
  'robin',
  'sail',
  'shore',
  'sparrow',
  'spring',
  'stone',
  'summit',
  'tide',
  'valley',
  'willow',
] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Local-time `YYYYMMDDHHmm`. Deliberately not `toISOString()`: the name is read
 * by the person who created it, against their own clock, not UTC.
 */
export const formatWorktreeTimestamp = (date: Date = new Date()): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;

const pick = <T>(pool: readonly T[], random: () => number): T =>
  pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];

/**
 * Whether a ref already occupies the candidate's path. Git stores refs as paths,
 * so `refs/heads/wt` and `refs/heads/wt/x` cannot coexist — creating the second
 * fails with `cannot lock ref … 'refs/heads/wt' exists`. Matching names exactly
 * cannot see that, and the reverse (the candidate becoming an ancestor of an
 * existing ref) is refused the same way, so every path segment is checked.
 */
const refPathConflict = (candidate: string, taken: ReadonlySet<string>): boolean => {
  if (taken.has(candidate)) return true;

  for (let end = candidate.indexOf('/'); end !== -1; end = candidate.indexOf('/', end + 1)) {
    if (taken.has(candidate.slice(0, end))) return true;
  }

  for (const ref of taken) {
    if (ref.startsWith(`${candidate}/`)) return true;
  }

  return false;
};

export interface GenerateWorktreeBranchNameOptions {
  /**
   * Refs the caller already has in view. Branch names count, including one that
   * names a path SEGMENT rather than a leaf (a branch literally called `wt`
   * blocks the whole `wt/` namespace). The draw retries a bounded number of
   * times against them, and a repeat beats no name (mirrors `randomAgentName`).
   */
  exclude?: Iterable<string>;
  now?: Date;
  random?: () => number;
}

const drawWith = (shape: () => string, taken: ReadonlySet<string>): string => {
  let candidate = shape();
  for (let i = 0; i < 20 && refPathConflict(candidate, taken); i++) candidate = shape();
  return candidate;
};

/**
 * Draw a branch name for a new worktree, with the timestamp taken from `now`
 * and the word pair from `random`. Both are injectable so callers stay testable.
 *
 * Names are namespaced (`wt/<timestamp>-…`) so app-created worktrees group
 * together in the branch list. Every namespaced draw shares the `wt` segment, so
 * a ref living there can never be drawn around — that namespace is unusable, and
 * the flat `wt-<timestamp>-…` form takes over rather than handing the user a
 * name git is guaranteed to refuse.
 */
export const generateWorktreeBranchName = ({
  exclude,
  now = new Date(),
  random = Math.random,
}: GenerateWorktreeBranchNameOptions = {}): string => {
  const taken = new Set(
    [...(exclude ?? [])].map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  const timestamp = formatWorktreeTimestamp(now);
  const tail = () =>
    `${timestamp}-${pick(WORKTREE_ADJECTIVES, random)}-${pick(WORKTREE_NOUNS, random)}`;

  if (taken.has(WORKTREE_BRANCH_PREFIX)) {
    return drawWith(() => `${WORKTREE_BRANCH_PREFIX}-${tail()}`, taken);
  }

  return drawWith(() => `${WORKTREE_BRANCH_PREFIX}/${tail()}`, taken);
};
