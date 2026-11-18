/**
 * The per-directory "New worktree" switch of the Better Coding Experience lab.
 *
 * Remembered per workspace + user (the preference bucket it is stored in) and
 * per device + directory (the key). Deliberately NOT on the device's shared
 * `workingDirs`: a workspace device is used by every member, while this switch
 * is one member's habit.
 *
 * Stored as the list of keys whose switch is ON, most recently set first. Off
 * is the default, so only "on" carries information; a list rather than a map
 * because jsonb does not keep object key order, and the cap evicts the least
 * recently set directory.
 */
export const WORKTREE_MODE_DIRS_LIMIT = 200;

const isSep = (ch: string): boolean => ch === '/' || ch === '\\';

/**
 * A directory path in the one spelling used for comparisons: trimmed, without
 * trailing separators (a bare root keeps its separator). Linear scan rather than
 * an anchored regex — this runs on the server over untrusted input.
 */
export const normalizeDirectoryPath = (path: string): string => {
  const trimmed = path.trim();
  let end = trimmed.length;
  while (end > 1 && isSep(trimmed[end - 1])) end -= 1;
  return trimmed.slice(0, end);
};

/** `<deviceId>::<normalized path>` — `deviceId` is the real one, also for this machine. */
export const getWorktreeModeKey = (deviceId: string, path: string): string =>
  `${deviceId}::${normalizeDirectoryPath(path)}`;

/** The list after setting `key`: moved to the front when on, dropped when off, capped. */
export const applyWorktreeModeDir = (
  current: readonly string[] | undefined,
  key: string,
  enabled: boolean,
): string[] => {
  const rest = (current ?? []).filter((entry) => entry !== key);
  return (enabled ? [key, ...rest] : rest).slice(0, WORKTREE_MODE_DIRS_LIMIT);
};
