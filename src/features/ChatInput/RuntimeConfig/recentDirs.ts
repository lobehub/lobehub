export const RECENT_DIRS_KEY = 'lobechat-recent-working-directories';
export const MAX_RECENT_DIRS = 20;

export interface RecentDirEntry {
  path: string;
  repoType?: 'git' | 'github';
}

export const getRecentDirs = (): RecentDirEntry[] => {
  try {
    const stored = localStorage.getItem(RECENT_DIRS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: unknown) =>
        typeof item === 'string' ? { path: item } : (item as RecentDirEntry),
      )
      .filter((d): d is RecentDirEntry => !!d?.path);
  } catch {
    return [];
  }
};

export const addRecentDir = (entry: RecentDirEntry): RecentDirEntry[] => {
  const dirs = getRecentDirs().filter((d) => d.path !== entry.path);
  const updated = [entry, ...dirs].slice(0, MAX_RECENT_DIRS);
  localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated));
  return updated;
};

export const removeRecentDir = (path: string): RecentDirEntry[] => {
  const updated = getRecentDirs().filter((d) => d.path !== path);
  localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated));
  return updated;
};

/**
 * Backfill `repoType` on an existing entry without reordering the list.
 * No-op when the path isn't in recents (avoids polluting recents with
 * implicitly-set working directories from agent config).
 */
export const setRecentDirRepoType = (
  path: string,
  repoType: 'git' | 'github' | undefined,
): void => {
  const dirs = getRecentDirs();
  const idx = dirs.findIndex((d) => d.path === path);
  if (idx === -1) return;
  if (dirs[idx].repoType === repoType) return;
  dirs[idx] = { ...dirs[idx], repoType };
  localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(dirs));
};
