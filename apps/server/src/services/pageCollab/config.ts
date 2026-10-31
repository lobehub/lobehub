import { appEnv } from '@/envs/app';

import { createPageRoomClient } from './roomClient';

/** Pages edit through live rooms only where the deployment's gateway has them (Cloud). */
export const isPageCollabEnabled = () => !!appEnv.ENABLE_PAGE_COLLAB && !!createPageRoomClient();
