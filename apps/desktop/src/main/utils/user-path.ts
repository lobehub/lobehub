import { app } from 'electron';

import { createLogger } from '@/utils/logger';

const logger = createLogger('utils:user-path');

type UserPathName = Parameters<typeof app.getPath>[0];

// Windows resolves these through Known Folders; a redirected or missing
// folder (e.g. OneDrive "Pictures") makes app.getPath throw instead of
// returning a fallback.
export const safeGetPath = (name: UserPathName): string | undefined => {
  try {
    return app.getPath(name);
  } catch (error) {
    logger.warn(`app.getPath('${name}') failed:`, error);
    return undefined;
  }
};
