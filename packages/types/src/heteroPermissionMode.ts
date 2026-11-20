/**
 * Claude Code permission modes a topic can run in (Better Coding Experience
 * lab). Claude Code also has `dontAsk`, which is deliberately not offered.
 *
 * - `default`: ask before every edit and command.
 * - `acceptEdits`: edits run, commands still ask.
 * - `auto`: Claude Code's own classifier decides what to ask.
 * - `plan`: read-only until the plan is approved.
 * - `bypassPermissions`: never ask (what every run did before the lab).
 */
export const HETERO_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'auto',
  'plan',
  'bypassPermissions',
] as const;

export type HeteroPermissionMode = (typeof HETERO_PERMISSION_MODES)[number];

/** Opening the lab changes nothing until the user picks another mode. */
export const DEFAULT_HETERO_PERMISSION_MODE: HeteroPermissionMode = 'bypassPermissions';

export const isHeteroPermissionMode = (value: unknown): value is HeteroPermissionMode =>
  typeof value === 'string' && (HETERO_PERMISSION_MODES as readonly string[]).includes(value);

/**
 * Why a run is not in the mode the user picked:
 *
 * - `root`: Claude Code refuses `bypassPermissions` as root (a cloud sandbox),
 *   so the run uses `acceptEdits` with the common tools pre-approved.
 * - `outdatedCli`: the device's `lh` predates permission modes and ran the
 *   topic with every action allowed.
 */
export type HeteroPermissionModeFallback = 'outdatedCli' | 'root';

/**
 * The mode a topic starts its next new topic with, remembered per device +
 * directory (see `getWorktreeModeKey`) and stored per workspace + user like the
 * "New worktree" switch. Most recently set first; the default mode is not
 * stored, so a list rather than a map keeps the eviction order jsonb loses.
 */
export interface HeteroPermissionModeDir {
  key: string;
  mode: HeteroPermissionMode;
}

export const HETERO_PERMISSION_MODE_DIRS_LIMIT = 200;

/** The remembered mode for `key`, or the default when none is stored. */
export const readHeteroPermissionModeDir = (
  dirs: readonly HeteroPermissionModeDir[] | undefined,
  key: string,
): HeteroPermissionMode => {
  const mode = dirs?.find((entry) => entry.key === key)?.mode;
  return isHeteroPermissionMode(mode) ? mode : DEFAULT_HETERO_PERMISSION_MODE;
};

/** The list after remembering `mode` for `key`: moved to the front, the default dropped, capped. */
export const applyHeteroPermissionModeDir = (
  current: readonly HeteroPermissionModeDir[] | undefined,
  key: string,
  mode: HeteroPermissionMode,
): HeteroPermissionModeDir[] => {
  const rest = (current ?? []).filter(
    (entry) => entry.key !== key && isHeteroPermissionMode(entry.mode),
  );
  return (mode === DEFAULT_HETERO_PERMISSION_MODE ? rest : [{ key, mode }, ...rest]).slice(
    0,
    HETERO_PERMISSION_MODE_DIRS_LIMIT,
  );
};
