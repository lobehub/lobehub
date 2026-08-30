import { agentConfigViewContract, projectionPrefetch } from '@/projection';
import type { RoutePrefetch } from '@/spa/router/routeMeta';

/**
 * The conversation header resolves its title and avatar from the Agent record.
 * Topic lists are not warmed here: their index key needs a container key the
 * route params don't carry.
 */
export const agentRoutePrefetch: RoutePrefetch = ({ aid }) =>
  aid ? [projectionPrefetch(agentConfigViewContract, { id: aid })] : [];
