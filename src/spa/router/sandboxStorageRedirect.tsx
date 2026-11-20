import { Navigate, useLocation } from 'react-router';

import { legacySandboxStoragePath } from './sandboxStoragePath';

/**
 * Sandbox storage left settings for Docs (T-2725): `/settings/drive` and
 * `/:workspaceSlug/settings/drive` now live at `…/resource/sandbox-storage`.
 * The workspace prefix, `?drive=` and the hash carry over.
 */
export const LegacySandboxStorageRedirect = () => {
  const { hash, pathname, search } = useLocation();

  return <Navigate replace to={{ hash, pathname: legacySandboxStoragePath(pathname), search }} />;
};
