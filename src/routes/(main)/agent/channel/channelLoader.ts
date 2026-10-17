import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { useAgentStore } from '@/store/agent';

/**
 * Route loader for the agent channel surface (`/agent/:aid/channel`).
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted channel data (an async IndexedDB read) can land before the channel
 * page paints its loading skeleton. See `preHydrateBotChannels`.
 */
export const channelDataLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  await settleWithin(
    useAgentStore.getState().preHydrateBotChannels(params.aid),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
