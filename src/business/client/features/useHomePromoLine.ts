import type { ReactNode } from 'react';

/**
 * The time-sensitive promotion shown in Home's header. Returning a node lets
 * the Home layout know whether a campaign is live, so it can keep the Agent's
 * daily-brief bubble out of the same attention lane until the campaign is
 * dismissed or expires.
 */
export const useHomePromoLine = (): ReactNode | undefined => undefined;
