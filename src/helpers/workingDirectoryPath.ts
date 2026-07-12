import type { WorkingDirConfig, WorkingDirRepoType } from '@lobechat/types';
import { pickString } from '@lobechat/utils';

import { isDesktop } from '@/const/version';

/**
 * The persisted repo type for a working-dir config, applying the web default:
 * on web there is no local filesystem to probe, so an unset type on an EXISTING
 * config is treated as `github` (the only web-supported repo source); on desktop
 * it stays `undefined` so callers fall back to a live probe.
 *
 * No config at all means "nothing was ever persisted" — that must stay
 * `undefined` on every platform, otherwise a web caller would treat any bare
 * device cwd as a GitHub repo and fire git/PR probes at directories that were
 * never identified as one.
 *
 * Shared by the topic meta hover card and the ControlBar git status so both read
 * repoType from the same source instead of diverging.
 */
export const getConfigRepoType = (config?: WorkingDirConfig): WorkingDirRepoType | undefined => {
  if (!config) return undefined;

  return config.repoType ?? (isDesktop ? undefined : 'github');
};

export const getWorkingDirectoryPathString = (path: unknown) => {
  const value = pickString(path)?.trim();
  return value || undefined;
};

// Last non-empty path segment — the folder name. Also yields the repo name for
// a web github URL (".../owner/repo" -> "repo").
export const getWorkingDirectoryName = (path: unknown) => {
  const value = getWorkingDirectoryPathString(path);
  if (!value) return;

  return value.replaceAll('\\', '/').split('/').findLast(Boolean) || value;
};
