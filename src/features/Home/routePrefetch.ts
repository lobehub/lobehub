import {
  homeBriefsViewContract,
  homeInboxTopicsViewContract,
  homeRecentTopicsViewContract,
  projectionPrefetch,
} from '@/projection';
import type { RoutePrefetch } from '@/spa/router/routeMeta';

import { HOME_COUNT_MAX } from './CustomizeModal/config';

/**
 * The blocks Home paints above the fold. Tasks and goals are deliberately absent:
 * they sit below the recents column, so warming them here would only compete with
 * the surfaces the user is already looking at.
 */
export const homeRoutePrefetch: RoutePrefetch = () => [
  projectionPrefetch(homeRecentTopicsViewContract, { limit: HOME_COUNT_MAX, view: 'mine' }),
  projectionPrefetch(homeInboxTopicsViewContract, {}),
  projectionPrefetch(homeBriefsViewContract, {}),
];
