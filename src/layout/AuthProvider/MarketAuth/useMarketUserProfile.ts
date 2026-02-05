import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import type {MarketUserProfile} from './types';

/**
 * Fetcher function for user profile using tRPC
 */
const fetchUserProfile = async (username: string): Promise<MarketUserProfile | null> => {
  const result = await lambdaClient.market.user.getUserByUsername.query({ username });
  return result as MarketUserProfile;
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
