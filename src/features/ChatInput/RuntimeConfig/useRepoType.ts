import { isDesktop } from '@lobechat/const';
import { useEffect, useMemo } from 'react';
import useSWR from 'swr';

import { electronGitService } from '@/services/electron/git';

import { getRecentDirs, setRecentDirRepoType } from './recentDirs';

export type RepoType = 'git' | 'github' | undefined;

/**
 * Resolve the repo type for a working directory.
 *
 * Cached entries from `recentDirs` (populated when the user picks a folder)
 * are used as a fast path. Legacy/string entries and agent-config-driven
 * paths that never went through the picker have no cached `repoType`, so
 * we probe the filesystem via IPC and backfill the cache.
 */
export const useRepoType = (path?: string): RepoType => {
  const cached = useMemo<RepoType>(() => {
    if (!path) return undefined;
    return getRecentDirs().find((d) => d.path === path)?.repoType;
  }, [path]);

  const shouldProbe = isDesktop && !!path && !cached;

  const { data: probed } = useSWR(
    shouldProbe ? ['detect-repo-type', path] : null,
    () => electronGitService.detectRepoType(path!),
    {
      dedupingInterval: 60 * 1000,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  useEffect(() => {
    if (path && probed !== undefined) setRecentDirRepoType(path, probed);
  }, [path, probed]);

  return cached ?? probed;
};
