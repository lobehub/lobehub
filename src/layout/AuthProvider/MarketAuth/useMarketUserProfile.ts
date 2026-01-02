import useSWR from 'swr';

import { MARKET_ENDPOINTS } from '@/services/_url';

import { type MarketUserProfile } from './types';

/**
 * Fetcher function for user profile
 */
const fetchUserProfile = async (username: string): Promise<MarketUserProfile | null> => {
  const response = await fetch(MARKET_ENDPOINTS.getUserProfile(username));

  if (!response.ok) {
    throw new Error(`Failed to fetch user profile: ${response.status}`);
  }

  return response.json();
};

/**
 * Hook to fetch and cache Market user profile using SWR
 *
 * @param username - The username to fetch profile for (typically userInfo.sub)
 * @returns SWR response with user profile data
 */
export const useMarketUserProfile = (username: string | null | undefined) => {
  return useSWR<MarketUserProfile | null>(
    username ? ['market-user-profile', username] : null,
    () => fetchUserProfile(username!),
    {
      dedupingInterval: 60_000, // 1 minute deduplication
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
