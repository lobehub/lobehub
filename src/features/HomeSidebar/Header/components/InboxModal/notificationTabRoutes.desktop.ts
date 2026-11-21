import type { RouteObject } from 'react-router';

import { mainAreaMetaRoutes } from '@/spa/router/desktopRouter.config';

export const getNotificationTabRoutes = (): RouteObject[] | undefined => mainAreaMetaRoutes;
